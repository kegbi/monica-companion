#!/usr/bin/env npx tsx

import { type ChildProcess, execSync, spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");
const CLAUDE_WORK = join(PROJECT_ROOT, ".claude-work");
const LOGS_DIR = join(CLAUDE_WORK, "logs");
const RUNNER_LOG = join(CLAUDE_WORK, "runner.log");
const LATEST_LOG = join(LOGS_DIR, "run-latest.log");
const CURRENT_SCRIPT = join(CLAUDE_WORK, "run.sh"); // fixed short name for send-keys

// Ensure log directories exist
mkdirSync(LOGS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Config (overridable via CLI args)
// ---------------------------------------------------------------------------
const DEFAULT_TASK_TIMEOUT_MS = 120 * 60 * 1000; // 120 min per task
const MAX_NO_PROGRESS_RUNS = 3; // stop after N consecutive runs without progress
const MAX_TOTAL_RUNS = 50; // safety cap
const SENTINEL_POLL_MS = 2000; // how often to check for pane completion

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

When run inside a psmux session, the runner automatically opens a side
pane showing live Claude output. Start with:
  psmux new-session -s orch
  npx tsx run.ts
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
		appendFileSync(RUNNER_LOG, `${line}\n`);
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
// Per-run log file
// ---------------------------------------------------------------------------
function createRunLogFile(run: number): string {
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const logFile = join(LOGS_DIR, `run-${String(run).padStart(3, "0")}-${ts}.log`);
	writeFileSync(logFile, "");
	return logFile;
}

// ---------------------------------------------------------------------------
// Claude CLI resolution
// ---------------------------------------------------------------------------
function resolveClaudeCli(): string {
	const home = process.env.HOME || process.env.USERPROFILE || "";

	// 1. Check well-known install locations (no shell needed)
	const candidates = [
		join(home, ".local", "bin", "claude"),
		join(home, ".local", "bin", "claude.exe"),
		join(home, "AppData", "Roaming", "npm", "claude"),
		join(home, "AppData", "Roaming", "npm", "claude.cmd"),
	];
	for (const p of candidates) {
		if (existsSync(p)) return p;
	}

	// 2. Try shell-based resolution as fallback
	const shellCmds = process.platform === "win32" ? ["where claude"] : ["which claude"];
	for (const cmd of shellCmds) {
		try {
			const result = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
				.trim()
				.split("\n")[0];
			if (result) return result;
		} catch {
			/* try next */
		}
	}

	console.error("ERROR: 'claude' CLI not found. Checked:");
	for (const p of candidates) console.error(`  - ${p}`);
	console.error("Install Claude Code first.");
	process.exit(1);
}

/** Convert Windows path to MSYS2/Git Bash path (C:\foo → /c/foo) */
function toBashPath(p: string): string {
	const fwd = p.replace(/\\/g, "/");
	// Convert drive letter: C:/... → /c/...
	return fwd.replace(/^([A-Za-z]):\//, (_m, drive: string) => `/${drive.toLowerCase()}/`);
}

// ---------------------------------------------------------------------------
// psmux integration
// ---------------------------------------------------------------------------
const IN_PSMUX = !!process.env.TMUX;

function psmuxExec(args: string): string {
	return execSync(`psmux ${args}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function isPaneAlive(paneId: string): boolean {
	try {
		const panes = psmuxExec('list-panes -F "#{pane_id}"');
		return panes.includes(paneId);
	} catch {
		return false;
	}
}

function createAgentPane(): string {
	// Split horizontally (side-by-side), agent gets 65%, don't focus it (-d)
	// -P -F prints the new pane's id
	// Use bash shell and set cwd to project root so relative paths work
	const cwd = toBashPath(PROJECT_ROOT);
	// Use login shell (-l) so the pane inherits PATH from user profile (needed for claude CLI)
	const paneId = psmuxExec(`split-window -h -d -l 65% -c "${cwd}" -P -F "#{pane_id}" "bash -l"`);
	log(`Agent pane created: ${paneId}`);
	return paneId;
}

function ensureAgentPane(currentPaneId: string | null): string {
	if (currentPaneId && isPaneAlive(currentPaneId)) return currentPaneId;
	return createAgentPane();
}

function sentinelPath(runLogFile: string): string {
	return `${runLogFile}.done`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run Claude in a psmux pane. The agent gets a real terminal (full output
 * visible in the pane), while stdout is also tee'd to a log file so the
 * runner can parse it for completion signals.
 */
async function runClaudeInPane(
	paneId: string,
	prompt: string,
	timeoutMs: number,
	runLogFile: string,
	claudeBin: string,
): Promise<ClaudeResult> {
	const sentinel = sentinelPath(runLogFile);
	const logPath = toBashPath(runLogFile);
	const latestPath = toBashPath(LATEST_LOG);
	const sentinelBash = toBashPath(sentinel);

	// Clean up previous sentinel
	if (existsSync(sentinel)) unlinkSync(sentinel);

	// Write wrapper script to a fixed short-name path (avoids long-path
	// truncation when psmux send-keys passes it to the pane shell)
	const claudeBash = toBashPath(claudeBin);
	const claudeCmd = `"${claudeBash}" -p ${shellQuote(prompt)} --dangerously-skip-permissions --output-format text`;
	writeFileSync(
		CURRENT_SCRIPT,
		[
			"#!/usr/bin/env bash",
			"set -o pipefail",
			"clear",
			`echo '━━━ Run started: '$(date)' ━━━'`,
			`> "${latestPath}"`,
			`${claudeCmd} 2>&1 | tee "${logPath}" "${latestPath}"`,
			"EXIT_CODE=${PIPESTATUS[0]}",
			`echo ""`,
			`echo "━━━ Finished (exit=$EXIT_CODE) ━━━"`,
			`echo $EXIT_CODE > "${sentinelBash}"`,
			"",
		].join("\n"),
	);

	// Send short relative path to the agent pane (cwd is PROJECT_ROOT)
	psmuxExec(`send-keys -t ${paneId} "bash .claude-work/run.sh" Enter`);

	// Poll for the sentinel file
	const start = Date.now();
	while (true) {
		await sleep(SENTINEL_POLL_MS);
		const elapsed = Date.now() - start;

		if (existsSync(sentinel)) {
			const exitCode = Number.parseInt(readFileSync(sentinel, "utf-8").trim(), 10) || 1;
			const stdout = existsSync(runLogFile) ? readFileSync(runLogFile, "utf-8") : "";
			try {
				unlinkSync(sentinel);
			} catch {
				/* ok */
			}
			return { exitCode, stdout, durationMs: elapsed, timedOut: false };
		}

		if (elapsed > timeoutMs) {
			log("Task timed out — sending Ctrl+C to agent pane");
			try {
				psmuxExec(`send-keys -t ${paneId} C-c`);
			} catch {
				/* ok */
			}
			// Wait a moment for tee to flush
			await sleep(2000);
			const stdout = existsSync(runLogFile) ? readFileSync(runLogFile, "utf-8") : "";
			return { exitCode: 124, stdout, durationMs: elapsed, timedOut: true };
		}
	}
}

// ---------------------------------------------------------------------------
// Fallback: pipe-based Claude invocation (no psmux)
// ---------------------------------------------------------------------------
interface ClaudeResult {
	exitCode: number;
	stdout: string;
	durationMs: number;
	timedOut: boolean;
}

function shellQuote(s: string): string {
	return `"${s.replace(/"/g, '\\"')}"`;
}

function forceKillProcess(proc: ChildProcess) {
	if (proc.pid == null) return;
	if (process.platform === "win32") {
		try {
			execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "ignore" });
		} catch {
			/* already dead */
		}
	} else {
		try {
			proc.kill("SIGKILL");
		} catch {
			/* already dead */
		}
	}
}

function runClaudePiped(
	prompt: string,
	timeoutMs: number,
	runLogFile: string,
	claudeBin: string,
): Promise<ClaudeResult> {
	return new Promise((res) => {
		const start = Date.now();
		let stdout = "";
		let timedOut = false;

		const cmd = `"${claudeBin}" -p ${shellQuote(prompt)} --dangerously-skip-permissions --output-format text`;

		const header = `$ ${cmd}\n${"─".repeat(60)}\n`;
		appendFileSync(runLogFile, header);
		writeFileSync(LATEST_LOG, header);

		const proc: ChildProcess = spawn(cmd, [], {
			cwd: PROJECT_ROOT,
			stdio: ["ignore", "pipe", "pipe"],
			shell: true,
		});

		const timer = setTimeout(() => {
			timedOut = true;
			log("Task timed out — killing process tree");
			forceKillProcess(proc);
		}, timeoutMs);

		proc.stdout?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stdout += text;
			process.stdout.write(text);
			try {
				appendFileSync(runLogFile, text);
			} catch {
				/* ok */
			}
			try {
				appendFileSync(LATEST_LOG, text);
			} catch {
				/* ok */
			}
		});

		proc.stderr?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			process.stderr.write(text);
			const tagged = `[stderr] ${text}`;
			try {
				appendFileSync(runLogFile, tagged);
			} catch {
				/* ok */
			}
			try {
				appendFileSync(LATEST_LOG, tagged);
			} catch {
				/* ok */
			}
		});

		proc.on("close", (code) => {
			clearTimeout(timer);
			const dur = formatDuration(Date.now() - start);
			const footer = `\n${"─".repeat(60)}\nExited: code=${code ?? "null"} duration=${dur} timedOut=${timedOut}\n`;
			try {
				appendFileSync(runLogFile, footer);
			} catch {
				/* ok */
			}
			try {
				appendFileSync(LATEST_LOG, footer);
			} catch {
				/* ok */
			}
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
			res({ exitCode: 1, stdout, durationMs: Date.now() - start, timedOut: false });
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
	logFile?: string;
}

async function main() {
	const config = parseArgs();

	console.log("================================================================");
	console.log("  Orchestrate Runner — Fresh Context Per Task");
	console.log("================================================================");
	log(`Project:      ${PROJECT_ROOT}`);
	log(`Logs dir:     ${LOGS_DIR}`);
	log(`Timeout:      ${config.taskTimeoutMs / 60_000}m per task`);
	log(`Max no-progress runs: ${config.maxNoProgress}`);
	log(`Max total runs:       ${config.maxRuns}`);
	if (config.filter) log(`Filter:       ${config.filter}`);
	console.log("");

	// psmux auto-detection
	let agentPaneId: string | null = null;

	if (IN_PSMUX) {
		log("psmux session detected — agent output will appear in a side pane");
		agentPaneId = createAgentPane();
	} else {
		log(
			"Not inside psmux — using inline output (start with 'psmux new-session -s orch' for side pane)",
		);
		log("Tip: tail -f .claude-work/logs/run-latest.log");
	}
	console.log("");

	// Resolve absolute path to claude CLI.
	// On Windows, claude may only be in the bash profile PATH, not in CMD's PATH
	// that Node.js inherits, so check well-known install locations first.
	const claudeBin = resolveClaudeCli();
	log(`Claude CLI: ${claudeBin}`);

	const results: TaskResult[] = [];
	let consecutiveNoProgress = 0;

	for (let run = 1; run <= config.maxRuns; run++) {
		// Snapshot state before invocation
		const beforeStates = readTaskStates();
		const beforeCompleted = getIdsByStatus(beforeStates, "completed");
		const beforeFailed = getIdsByStatus(beforeStates, "failed");

		// Create per-run log file
		const runLogFile = createRunLogFile(run);

		console.log("");
		log(`${"━".repeat(64)}`);
		log(`  Run #${run} | Completed: ${beforeCompleted.size} | Failed: ${beforeFailed.size}`);
		log(`  Log: ${runLogFile}`);
		log(`${"━".repeat(64)}`);
		console.log("");

		// Build prompt
		const filterArg = config.filter ? ` "${config.filter}"` : "";
		const prompt = `/orchestrate --auto --single-task${filterArg}`;

		// Invoke Claude — psmux pane or piped fallback
		let result: ClaudeResult;
		if (agentPaneId) {
			agentPaneId = ensureAgentPane(agentPaneId);
			result = await runClaudeInPane(
				agentPaneId,
				prompt,
				config.taskTimeoutMs,
				runLogFile,
				claudeBin,
			);
		} else {
			result = await runClaudePiped(prompt, config.taskTimeoutMs, runLogFile, claudeBin);
		}

		const { exitCode, stdout, durationMs, timedOut } = result;
		const dur = formatDuration(durationMs);

		// Check for "all complete" in output
		if (stdout.includes("All roadmap tasks are complete") || stdout.includes("all_complete")) {
			log(`All tasks complete (${dur})`);
			results.push({ status: "all_done", durationMs, logFile: runLogFile });
			break;
		}

		// Snapshot state after invocation
		const afterStates = readTaskStates();
		const afterCompleted = getIdsByStatus(afterStates, "completed");
		const afterFailed = getIdsByStatus(afterStates, "failed");

		const newlyCompleted = [...afterCompleted].filter((id) => !beforeCompleted.has(id));
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
					logFile: runLogFile,
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
					logFile: runLogFile,
				});
			}
		} else if (timedOut) {
			consecutiveNoProgress++;
			log(`Task timed out (${dur})`);
			results.push({ status: "timeout", durationMs, logFile: runLogFile });
		} else {
			consecutiveNoProgress++;
			log(`No state change detected (exit=${exitCode}, ${dur})`);
			results.push({ status: "no_progress", durationMs, logFile: runLogFile });
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
	console.log(`  Logs:      ${LOGS_DIR}`);
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
