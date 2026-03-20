/**
 * Voice latency validation smoke test.
 *
 * Measures the combined voice pipeline latency:
 *   1. Transcription leg: POST /internal/transcribe on voice-transcription service
 *   2. Text processing leg: POST /internal/process on ai-router (measured in text latency test)
 *
 * Combined p95 assertion: <= 12000ms
 *
 * NOTE: The combined p95 is a conservative upper bound calculated as
 * p95(transcription) + p95(text). The true combined p95 would be lower
 * because the two legs are independent and their p95s don't sum linearly.
 *
 * AUDIO FIXTURE: This test requires a small OGG Opus audio file at
 * __smoke__/fixtures/test-audio.ogg. If the fixture is not available,
 * the test will skip gracefully rather than fail.
 *
 * JWT signing uses issuer: "telegram-bridge" and audience: "voice-transcription"
 * to match the real production call path where telegram-bridge calls
 * voice-transcription directly.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { signServiceToken } from "@monica-companion/auth";
import { beforeAll, describe, expect, it } from "vitest";
import { sendMessage } from "./helpers.js";
import { loadLlmSmokeConfig } from "./smoke-config.js";

const AUDIO_FIXTURE_PATH = resolve(__dirname, "fixtures", "test-audio.ogg");

/** Sign a JWT for voice-transcription calls (telegram-bridge -> voice-transcription). */
async function signVoiceToken(userId: string): Promise<string> {
	const config = loadLlmSmokeConfig();
	return signServiceToken({
		issuer: "telegram-bridge",
		audience: "voice-transcription",
		secret: config.JWT_SECRET,
		subject: userId,
		ttlSeconds: 60,
	});
}

/** Send a transcription request to voice-transcription service. */
async function sendTranscriptionRequest(
	userId: string,
	audioBuffer: Buffer,
): Promise<{ status: number; body: Record<string, unknown> }> {
	const config = loadLlmSmokeConfig();
	const token = await signVoiceToken(userId);
	const correlationId = randomUUID();

	const formData = new FormData();
	formData.append(
		"metadata",
		JSON.stringify({
			correlationId,
			mimeType: "audio/ogg",
			durationSeconds: 3,
		}),
	);

	const audioBlob = new Blob([audioBuffer], { type: "audio/ogg" });
	formData.append("file", audioBlob, "test-audio.ogg");

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 60_000);

	try {
		const res = await fetch(`${config.VOICE_TRANSCRIPTION_URL}/internal/transcribe`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
			},
			body: formData,
			signal: controller.signal,
		});

		const body = (await res.json()) as Record<string, unknown>;
		return { status: res.status, body };
	} finally {
		clearTimeout(timer);
	}
}

/** Compute a percentile from a sorted array of numbers. */
function percentile(sorted: number[], p: number): number {
	const index = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, index)];
}

describe("Voice latency validation", { timeout: 600_000 }, () => {
	let audioBuffer: Buffer;
	let hasAudioFixture = false;

	beforeAll(async () => {
		// Check if audio fixture exists
		if (!existsSync(AUDIO_FIXTURE_PATH)) {
			console.warn(
				`\nSkipping voice latency test: audio fixture not found at ${AUDIO_FIXTURE_PATH}`,
			);
			console.warn(
				"To run this test, provide a small (3-5 second) OGG Opus audio file with clear English speech.\n",
			);
			return;
		}

		hasAudioFixture = true;
		audioBuffer = readFileSync(AUDIO_FIXTURE_PATH);

		// Health check voice-transcription
		const config = loadLlmSmokeConfig();
		const res = await fetch(`${config.VOICE_TRANSCRIPTION_URL}/health`);
		expect(res.status).toBe(200);

		// Health check ai-router
		const aiRes = await fetch(`${config.AI_ROUTER_URL}/health`);
		expect(aiRes.status).toBe(200);
	});

	it("combined voice p95 latency is within 12000ms threshold", async () => {
		if (!hasAudioFixture) {
			console.log("Skipping: no audio fixture available");
			return;
		}

		const TRANSCRIPTION_REQUESTS = 10;
		const TEXT_REQUESTS = 10;

		// --- Warmup ---
		const warmupUserId = randomUUID();
		await sendTranscriptionRequest(warmupUserId, audioBuffer);
		await sendMessage(warmupUserId, "Hello warmup");

		// --- Transcription latency ---
		const transcriptionLatencies: number[] = [];

		for (let i = 0; i < TRANSCRIPTION_REQUESTS; i++) {
			const userId = randomUUID();
			const start = performance.now();

			const { status, body } = await sendTranscriptionRequest(userId, audioBuffer);

			const elapsed = performance.now() - start;
			transcriptionLatencies.push(elapsed);

			expect(status).toBe(200);
			expect(body.success).toBe(true);
		}

		// --- Text processing latency (representative subset) ---
		const textMessages = [
			"Create a note for John about our meeting",
			"When is Jane's birthday?",
			"Hello!",
			"What's the weather like?",
			"Add a contact named Sarah",
			"What is Bob's phone number?",
			"Update Lisa's birthday",
			"Hi there!",
			"Write me a poem",
			"Create a note for Maria about lunch",
		];

		const textLatencies: number[] = [];

		for (let i = 0; i < TEXT_REQUESTS; i++) {
			const userId = randomUUID();
			const start = performance.now();

			const { status } = await sendMessage(userId, textMessages[i]);

			const elapsed = performance.now() - start;
			textLatencies.push(elapsed);

			expect(status).toBe(200);
		}

		// --- Compute percentiles ---
		const sortedTranscription = [...transcriptionLatencies].sort((a, b) => a - b);
		const sortedText = [...textLatencies].sort((a, b) => a - b);

		const transcP50 = percentile(sortedTranscription, 50);
		const transcP95 = percentile(sortedTranscription, 95);
		const transcP99 = percentile(sortedTranscription, 99);
		const transcMax = sortedTranscription[sortedTranscription.length - 1];

		const textP50 = percentile(sortedText, 50);
		const textP95 = percentile(sortedText, 95);
		const textP99 = percentile(sortedText, 99);
		const textMax = sortedText[sortedText.length - 1];

		const combinedP95 = transcP95 + textP95;

		// --- Print latency report ---
		console.log("\n=== Voice Latency Report ===");
		console.log("\nTranscription Leg:");
		console.log(`  Requests:  ${transcriptionLatencies.length}`);
		console.log(`  p50:       ${transcP50.toFixed(0)}ms`);
		console.log(`  p95:       ${transcP95.toFixed(0)}ms`);
		console.log(`  p99:       ${transcP99.toFixed(0)}ms`);
		console.log(`  Max:       ${transcMax.toFixed(0)}ms`);

		console.log("\nText Processing Leg:");
		console.log(`  Requests:  ${textLatencies.length}`);
		console.log(`  p50:       ${textP50.toFixed(0)}ms`);
		console.log(`  p95:       ${textP95.toFixed(0)}ms`);
		console.log(`  p99:       ${textP99.toFixed(0)}ms`);
		console.log(`  Max:       ${textMax.toFixed(0)}ms`);

		console.log("\nCombined (conservative upper bound*):");
		console.log(`  p95:       ${combinedP95.toFixed(0)}ms`);
		console.log("\n  * Combined p95 = p95(transcription) + p95(text).");
		console.log("    This is a conservative upper bound; the true combined p95");
		console.log("    is lower because the two legs are independent.");
		console.log("=============================\n");

		// --- Assert combined p95 threshold ---
		expect(combinedP95).toBeLessThanOrEqual(12000);
	});
});
