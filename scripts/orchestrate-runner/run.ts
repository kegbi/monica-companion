#!/usr/bin/env npx tsx

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");
const CLAUDE_WORK = join(PROJECT_ROOT, ".claude-work");
const LOG_FILE = join(CLAUDE_WORK, "runner.log");

// ---------------------------------------------------------------------------
// Config (overridable via CLI args)
// ---------------------------------------------------------------------------
const DEFAULT_TASK_TIMEOUT_MS = 120 * 60 * 1000; // 120 min per task
const MAX_NO_PROGRESS_RUNS = 3; // stop after N consecutive runs without progress
const MAX_TOTAL_RUNS = 50; // safety cap

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
interface RunnerConfig {
	taskTimeoutMs: number;
	maxNoProgress: number;
	maxRuns: number;
	filter: string | null;
}

function parseArgs(): RunnerConfig {
	const args = process.argv.slice(2);
	const config: RunnerConfig = {
		taskTimeoutMs: DEFAULT_TASK_TIMEOUT_MS,
		maxNoProgress: MAX_NO_PROGRESS_RUNS,
		maxRuns: MAX_TOTAL_RUNS,
		filter: null,
	};

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--timeout": {
				const mins = Number(args[++i]);
				if (Number.isNaN(mins) || mins <= 0) {
					console.error("--timeout requires a positive number (minutes)");
					process.exit(1);
				}
				config.taskTimeoutMs = mins * 60 * 1000;
				break;
			}
			case "--max-no-progress": {
				const n = Number(args[++i]);
				if (Number.isNaN(n) || n <= 0) {
					console.error("--max-no-progress requires a positive integer");
					process.exit(1);
				}
				config.maxNoProgress = n;
				break;
			}
			case "--max-runs": {
				const n = Number(args[++i]);
				if (Number.isNaN(n) || n <= 0) {
					console.error("--max-runs requires a positive integer");
					process.exit(1);
				}
				config.maxRuns = n;
				break;
			}
			case "--filter":
				config.filter = args[++i] ?? null;
				break;
			case "--help":
				printUsage();
				process.exit(0);
				break;
			default:
				console.error(`Unknown argument: ${args[i]}`);
				printUsage();
				process.exit(1);
		}
	}

	return config;
}

function printUsage() {
	console.log(`
Usage: npx tsx run.ts [options]

Options:
  --timeout <minutes>        Timeout per task invocation (default: 120)
  --max-no-progress <N>      Stop after N runs without progress (default: 3)
  --max-runs <N>             Safety cap on total runs (default: 50)
  --filter <task-name>       Only run tasks matching this name
  --help                     Show this help
`);
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------
interface TaskState {
	taskId: string;
	taskGroup: string;
	status: string;
	phase: string;
}

function readTaskStates(): Map<string, TaskState> {
	const states = new Map<string, TaskState>();
	if (!existsSync(CLAUDE_WORK)) return states;

	for (const entry of readdirSync(CLAUDE_WORK, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const stateFile = join(CLAUDE_WORK, entry.name, "state.json");
		if (!existsSync(stateFile)) continue;
		try {
			const state: TaskState = JSON.parse(readFileSync(stateFile, "utf-8"));
			states.set(state.taskId, state);
		} catch {
			/* skip corrupt state files */
		}
	}
	return states;
}

function getIdsByStatus(states: Map<string, TaskState>, status: string): Set<string> {
	const ids = new Set<string>();
	for (const s of states.values()) {
		if (s.status === status) ids.add(s.taskId);
	}
	return ids;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(msg: string) {
	const ts = new Date().toISOString();
	const line = `[${ts}] ${msg}`;
	console.log(line);
	try {
		writeFileSync(LOG_FILE, `${line}\n`, { flag: "a" });
	} catch {
		/* best-effort file logging */
	}
}

function formatDuration(ms: number): string {
	const mins = ms / 60_000;
	if (mins < 1) return `${(ms / 1000).toFixed(0)}s`;
	return `${mins.toFixed(1)}m`;
}

// ---------------------------------------------------------------------------
// Claude invocation
// ---------------------------------------------------------------------------
interface ClaudeResult {
	exitCode: number;
	stdout: string;
	durationMs: number;
	timedOut: boolean;
}

function shellQuote(s: string): string {
	// Escape double quotes inside, then wrap in double quotes for cmd/sh
	return `"${s.replace(/"/g, '\\"')}"`;
}

function runClaude(prompt: string, timeoutMs: number): Promise<ClaudeResult> {
	return new Promise((res) => {
		const start = Date.now();
		let stdout = "";
		let stderr = "";
		let timedOut = false;

		// Build as a single command string so the prompt (which contains
		// --auto --single-task) is properly quoted and not parsed as CLI flags.
		const cmd = `claude -p ${shellQuote(prompt)} --dangerously-skip-permissions --output-format text`;

		const proc: ChildProcess = spawn(cmd, [], {
			cwd: PROJECT_ROOT,
			stdio: ["ignore", "pipe", "pipe"],
			shell: true,
		});

		const timer = setTimeout(() => {
			timedOut = true;
			log("Task timed out — killing process");
			proc.kill("SIGTERM");
			// Force kill after 10s if SIGTERM doesn't work (Windows)
			setTimeout(() => {
				try {
					proc.kill("SIGKILL");
				} catch {
					/* already dead */
				}
			}, 10_000);
		}, timeoutMs);

		proc.stdout?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stdout += text;
			process.stdout.write(text);
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stderr += text;
			process.stderr.write(text);
		});

		proc.on("close", (code) => {
			clearTimeout(timer);
			res({
				exitCode: timedOut ? 124 : (code ?? 1),
				stdout,
				durationMs: Date.now() - start,
				timedOut,
			});
		});

		proc.on("error", (err) => {
			clearTimeout(timer);
			log(`Failed to spawn claude: ${err.message}`);
			res({
				exitCode: 1,
				stdout,
				durationMs: Date.now() - start,
				timedOut: false,
			});
		});
	});
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
interface TaskResult {
	taskId?: string;
	taskGroup?: string;
	status: "completed" | "failed" | "no_progress" | "all_done" | "timeout";
	durationMs: number;
}

async function main() {
	const config = parseArgs();

	console.log("================================================================");
	console.log("  Orchestrate Runner — Fresh Context Per Task");
	console.log("================================================================");
	log(`Project:      ${PROJECT_ROOT}`);
	log(`Timeout:      ${config.taskTimeoutMs / 60_000}m per task`);
	log(`Max no-progress runs: ${config.maxNoProgress}`);
	log(`Max total runs:       ${config.maxRuns}`);
	if (config.filter) log(`Filter:       ${config.filter}`);
	console.log("");

	// Verify claude CLI is available
	try {
		const check = spawn("claude --version", [], {
			shell: true,
			stdio: "pipe",
		});
		await new Promise<void>((res, rej) => {
			check.on("close", (code) => (code === 0 ? res() : rej(new Error(`exit ${code}`))));
			check.on("error", rej);
		});
	} catch {
		console.error("ERROR: 'claude' CLI not found in PATH. Install Claude Code first.");
		process.exit(1);
	}

	const results: TaskResult[] = [];
	let consecutiveNoProgress = 0;

	for (let run = 1; run <= config.maxRuns; run++) {
		// Snapshot state before invocation
		const beforeStates = readTaskStates();
		const beforeCompleted = getIdsByStatus(beforeStates, "completed");
		const beforeFailed = getIdsByStatus(beforeStates, "failed");

		console.log("");
		log(`${"━".repeat(64)}`);
		log(`  Run #${run} | Completed: ${beforeCompleted.size} | Failed: ${beforeFailed.size}`);
		log(`${"━".repeat(64)}`);
		console.log("");

		// Build prompt
		const filterArg = config.filter ? ` "${config.filter}"` : "";
		const prompt = `/orchestrate --auto --single-task${filterArg}`;

		// Invoke Claude with fresh context
		const { exitCode, stdout, durationMs, timedOut } = await runClaude(
			prompt,
			config.taskTimeoutMs,
		);

		const dur = formatDuration(durationMs);

		// Check for "all complete" in output
		if (stdout.includes("All roadmap tasks are complete") || stdout.includes("all_complete")) {
			log(`All tasks complete (${dur})`);
			results.push({ status: "all_done", durationMs });
			break;
		}

		// Snapshot state after invocation
		const afterStates = readTaskStates();
		const afterCompleted = getIdsByStatus(afterStates, "completed");
		const afterFailed = getIdsByStatus(afterStates, "failed");

		// Detect newly completed tasks
		const newlyCompleted = [...afterCompleted].filter((id) => !beforeCompleted.has(id));
		// Detect newly failed tasks
		const newlyFailed = [...afterFailed].filter((id) => !beforeFailed.has(id));

		if (newlyCompleted.length > 0) {
			consecutiveNoProgress = 0;
			for (const id of newlyCompleted) {
				const state = afterStates.get(id);
				const group = state?.taskGroup ?? id;
				log(`Task completed: ${group} (${dur})`);
				results.push({
					taskId: id,
					taskGroup: group,
					status: "completed",
					durationMs,
				});
			}
		} else if (newlyFailed.length > 0) {
			consecutiveNoProgress = 0;
			for (const id of newlyFailed) {
				const state = afterStates.get(id);
				const group = state?.taskGroup ?? id;
				log(`Task failed: ${group} (${dur})`);
				results.push({
					taskId: id,
					taskGroup: group,
					status: "failed",
					durationMs,
				});
			}
		} else if (timedOut) {
			consecutiveNoProgress++;
			log(`Task timed out (${dur})`);
			results.push({ status: "timeout", durationMs });
		} else {
			consecutiveNoProgress++;
			log(`No state change detected (exit=${exitCode}, ${dur})`);
			results.push({ status: "no_progress", durationMs });
		}

		if (consecutiveNoProgress >= config.maxNoProgress) {
			log(`Stopping: ${config.maxNoProgress} consecutive runs without progress`);
			break;
		}
	}

	printSummary(results);
}

function printSummary(results: TaskResult[]) {
	const completed = results.filter((r) => r.status === "completed");
	const failed = results.filter((r) => r.status === "failed");
	const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0);

	console.log("");
	console.log("================================================================");
	console.log("  Final Summary");
	console.log("================================================================");

	for (const r of results) {
		if (r.status === "all_done") continue;
		const icon = r.status === "completed" ? "[OK]  " : r.status === "failed" ? "[FAIL]" : "[--]  ";
		const name = r.taskGroup ?? r.taskId ?? r.status;
		console.log(`  ${icon} ${name} (${formatDuration(r.durationMs)})`);
	}

	console.log("");
	console.log(`  Completed: ${completed.length}`);
	console.log(`  Failed:    ${failed.length}`);
	console.log(`  Total:     ${formatDuration(totalTime)}`);
	console.log("================================================================");
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
process.on("SIGINT", () => {
	log("Interrupted (Ctrl+C). Exiting...");
	process.exit(130);
});

process.on("SIGTERM", () => {
	log("Terminated. Exiting...");
	process.exit(143);
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
main().catch((err) => {
	console.error("[runner] Fatal error:", err);
	process.exit(1);
});
