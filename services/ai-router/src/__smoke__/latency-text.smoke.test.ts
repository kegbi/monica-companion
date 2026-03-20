/**
 * Text latency validation smoke test.
 *
 * Sends 20 representative text messages through POST /internal/process,
 * measures wall-clock time, and computes p50/p95/p99/max latency percentiles.
 *
 * Asserts: p95 <= 5000ms (acceptance criteria for text input).
 *
 * Requires the full Docker Compose stack running with a real OpenAI API key.
 * A warmup request is sent first and excluded from metrics.
 */

import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sendMessage } from "./helpers.js";
import { loadLlmSmokeConfig } from "./smoke-config.js";

/** Representative test messages covering different intent types. */
const TEST_MESSAGES: Array<{ text: string; expectedIntent: string }> = [
	// Write intents
	{ text: "Create a note for John about our meeting yesterday", expectedIntent: "write" },
	{ text: "Add a contact named Sarah Miller", expectedIntent: "write" },
	{ text: "Update Jane's birthday to March 15th", expectedIntent: "write" },
	{ text: "Create a note for Lisa about the project deadline", expectedIntent: "write" },
	{ text: "Add a new contact Bob Johnson", expectedIntent: "write" },

	// Read intents
	{ text: "When is Jane's birthday?", expectedIntent: "read" },
	{ text: "What is John's phone number?", expectedIntent: "read" },
	{ text: "When is Sarah's birthday?", expectedIntent: "read" },
	{ text: "What is Lisa's email?", expectedIntent: "read" },
	{ text: "Tell me about my contact Bob", expectedIntent: "read" },

	// Greeting intents
	{ text: "Hello!", expectedIntent: "greeting" },
	{ text: "Hi there, how are you?", expectedIntent: "greeting" },
	{ text: "Good morning", expectedIntent: "greeting" },
	{ text: "Hey!", expectedIntent: "greeting" },

	// Out of scope intents
	{ text: "What's the weather like today?", expectedIntent: "out_of_scope" },
	{ text: "Write me a Python script", expectedIntent: "out_of_scope" },
	{ text: "Who won the World Cup?", expectedIntent: "out_of_scope" },
	{ text: "Tell me a joke", expectedIntent: "out_of_scope" },
	{ text: "What is the capital of France?", expectedIntent: "out_of_scope" },
	{ text: "Calculate 42 times 37", expectedIntent: "out_of_scope" },
];

/** Compute a percentile from a sorted array of numbers. */
function percentile(sorted: number[], p: number): number {
	const index = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, index)];
}

describe("Text latency validation", { timeout: 300_000 }, () => {
	beforeAll(async () => {
		const config = loadLlmSmokeConfig();
		const res = await fetch(`${config.AI_ROUTER_URL}/health`);
		expect(res.status).toBe(200);
	});

	it("p95 text latency is within 5000ms threshold", async () => {
		// --- Warmup request (excluded from metrics) ---
		const warmupUserId = randomUUID();
		await sendMessage(warmupUserId, "Hello, warmup request");

		// --- Timed requests ---
		const latencies: number[] = [];

		for (const testCase of TEST_MESSAGES) {
			const userId = randomUUID(); // Fresh user per request
			const start = performance.now();

			const { status } = await sendMessage(userId, testCase.text);

			const elapsed = performance.now() - start;
			latencies.push(elapsed);

			// Basic sanity: every request should succeed
			expect(status).toBe(200);
		}

		// --- Compute percentiles ---
		const sorted = [...latencies].sort((a, b) => a - b);
		const p50 = percentile(sorted, 50);
		const p95 = percentile(sorted, 95);
		const p99 = percentile(sorted, 99);
		const max = sorted[sorted.length - 1];
		const min = sorted[0];
		const avg = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;

		// --- Print latency report ---
		console.log("\n=== Text Latency Report ===");
		console.log(`Requests:  ${latencies.length}`);
		console.log(`Min:       ${min.toFixed(0)}ms`);
		console.log(`Avg:       ${avg.toFixed(0)}ms`);
		console.log(`p50:       ${p50.toFixed(0)}ms`);
		console.log(`p95:       ${p95.toFixed(0)}ms`);
		console.log(`p99:       ${p99.toFixed(0)}ms`);
		console.log(`Max:       ${max.toFixed(0)}ms`);
		console.log("===========================\n");

		// --- Per-request breakdown ---
		console.log("Per-request latencies:");
		for (let i = 0; i < TEST_MESSAGES.length; i++) {
			console.log(
				`  [${TEST_MESSAGES[i].expectedIntent.padEnd(12)}] ${latencies[i].toFixed(0)}ms - "${TEST_MESSAGES[i].text.slice(0, 50)}"`,
			);
		}

		// --- Assert p95 threshold ---
		expect(p95).toBeLessThanOrEqual(5000);
	});
});
