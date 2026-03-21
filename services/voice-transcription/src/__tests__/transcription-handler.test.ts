import { signServiceToken } from "@monica-companion/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptionResult, WhisperClient } from "../whisper-client";
import { TranscriptionError } from "../whisper-client";

// Mock guardrails to pass through
vi.mock("@monica-companion/guardrails", () => ({
	guardrailMiddleware: vi.fn().mockReturnValue(async (_c: any, next: any) => {
		await next();
	}),
	createGuardrailMetrics: vi.fn().mockReturnValue({
		recordRateLimitRejection: vi.fn(),
		recordConcurrencyRejection: vi.fn(),
		updateBudgetSpend: vi.fn(),
		updateBudgetLimit: vi.fn(),
		updateBudgetAlarm: vi.fn(),
		recordBudgetExhaustion: vi.fn(),
		updateKillSwitch: vi.fn(),
		recordKillSwitchRejection: vi.fn(),
		recordRequestAllowed: vi.fn(),
	}),
}));

// Mock audio-fetcher
const mockFetchAudio = vi.fn();
vi.mock("../audio-fetcher", () => ({
	fetchAudio: (...args: any[]) => mockFetchAudio(...args),
	AudioFetchError: class AudioFetchError extends Error {
		category: string;
		userMessage: string;
		constructor(category: string) {
			super(`fetch error: ${category}`);
			this.name = "AudioFetchError";
			this.category = category;
			this.userMessage = `Audio fetch error: ${category}`;
		}
	},
}));

import { createApp } from "../app";

const JWT_SECRET = "test-secret-256-bit-minimum-key!";

const testConfig = {
	auth: {
		serviceName: "voice-transcription" as const,
		jwtSecrets: [JWT_SECRET],
	},
	openaiApiKey: "sk-test-key",
	whisperModel: "gpt-4o-transcribe",
	whisperTimeoutMs: 60000,
	whisperMaxFileSizeBytes: 25 * 1024 * 1024,
	fetchUrlTimeoutMs: 15000,
	whisperCostPerMinuteUsd: 0.006,
	redisUrl: "redis://localhost:6379",
	inboundAllowedCallers: ["telegram-bridge"],
	guardrails: {
		redisUrl: "redis://localhost:6379",
		rateLimitPerUser: 30,
		rateWindowSeconds: 60,
		concurrencyPerUser: 3,
		budgetLimitUsd: 100,
		budgetAlarmThresholdPct: 80,
		costPerRequestUsd: 0.01,
	},
};

const mockWhisperClient: WhisperClient = {
	transcribe: vi.fn(),
};

async function makeToken(opts?: { userId?: string }) {
	return signServiceToken({
		issuer: "telegram-bridge",
		audience: "voice-transcription",
		secret: JWT_SECRET,
		correlationId: "corr-test",
		subject: opts?.userId ?? "user-123",
	});
}

describe("transcription handler", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("returns successful transcription for binary upload", async () => {
		(mockWhisperClient.transcribe as any).mockResolvedValueOnce({
			text: "Hello world",
			detectedLanguage: "en",
		} satisfies TranscriptionResult);

		const app = createApp(testConfig, null as any, mockWhisperClient);
		const token = await makeToken();

		const formData = new FormData();
		formData.append(
			"metadata",
			JSON.stringify({
				mimeType: "audio/ogg",
				durationSeconds: 5,
				correlationId: "corr-test",
			}),
		);
		formData.append(
			"file",
			new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
			"audio.ogg",
		);

		const res = await app.request("/internal/transcribe", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: formData,
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.text).toBe("Hello world");
		expect(body.detectedLanguage).toBe("en");
		expect(body.correlationId).toBe("corr-test");
	});

	it("returns successful transcription with undefined detectedLanguage for gpt-4o-transcribe", async () => {
		(mockWhisperClient.transcribe as any).mockResolvedValueOnce({
			text: "Hello from gpt-4o-transcribe",
			detectedLanguage: undefined,
		} satisfies TranscriptionResult);

		const app = createApp(testConfig, null as any, mockWhisperClient);
		const token = await makeToken();

		const formData = new FormData();
		formData.append(
			"metadata",
			JSON.stringify({
				mimeType: "audio/ogg",
				durationSeconds: 5,
				correlationId: "corr-gpt4o",
			}),
		);
		formData.append(
			"file",
			new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
			"audio.ogg",
		);

		const res = await app.request("/internal/transcribe", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: formData,
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.text).toBe("Hello from gpt-4o-transcribe");
		expect(body.detectedLanguage).toBeUndefined();
		expect(body.correlationId).toBe("corr-gpt4o");
	});

	it("returns successful transcription for fetch-URL mode", async () => {
		const audioData = new Uint8Array([1, 2, 3, 4]);
		mockFetchAudio.mockResolvedValueOnce({
			buffer: audioData.buffer,
			contentType: "audio/ogg",
		});
		(mockWhisperClient.transcribe as any).mockResolvedValueOnce({
			text: "Fetched audio text",
			detectedLanguage: "es",
		} satisfies TranscriptionResult);

		const app = createApp(testConfig, null as any, mockWhisperClient);
		const token = await makeToken();

		const formData = new FormData();
		formData.append(
			"metadata",
			JSON.stringify({
				mimeType: "audio/ogg",
				durationSeconds: 3,
				correlationId: "corr-fetch",
				fetchUrl: "https://example.com/audio.ogg",
			}),
		);

		const res = await app.request("/internal/transcribe", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: formData,
		});

		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.text).toBe("Fetched audio text");
		expect(body.detectedLanguage).toBe("es");
	});

	it("rejects request with neither file nor fetchUrl", async () => {
		const app = createApp(testConfig, null as any, mockWhisperClient);
		const token = await makeToken();

		const formData = new FormData();
		formData.append(
			"metadata",
			JSON.stringify({
				mimeType: "audio/ogg",
				durationSeconds: 5,
				correlationId: "corr-missing",
			}),
		);

		const res = await app.request("/internal/transcribe", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: formData,
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toContain("No audio input");
		expect(body.correlationId).toBe("corr-missing");
	});

	it("rejects file that exceeds max size", async () => {
		const app = createApp(
			{ ...testConfig, whisperMaxFileSizeBytes: 10 },
			null as any,
			mockWhisperClient,
		);
		const token = await makeToken();

		const formData = new FormData();
		formData.append(
			"metadata",
			JSON.stringify({
				mimeType: "audio/ogg",
				durationSeconds: 5,
				correlationId: "corr-big",
			}),
		);
		formData.append("file", new Blob([new Uint8Array(100)], { type: "audio/ogg" }), "big.ogg");

		const res = await app.request("/internal/transcribe", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: formData,
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toContain("too large");
	});

	it("returns user-safe error when Whisper API fails", async () => {
		(mockWhisperClient.transcribe as any).mockRejectedValueOnce(
			new TranscriptionError("server_error"),
		);

		const app = createApp(testConfig, null as any, mockWhisperClient);
		const token = await makeToken();

		const formData = new FormData();
		formData.append(
			"metadata",
			JSON.stringify({
				mimeType: "audio/ogg",
				durationSeconds: 5,
				correlationId: "corr-fail",
			}),
		);
		formData.append(
			"file",
			new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
			"audio.ogg",
		);

		const res = await app.request("/internal/transcribe", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: formData,
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toBeDefined();
		expect(body.correlationId).toBe("corr-fail");
	});

	it("health endpoint still works", async () => {
		const app = createApp(testConfig, null as any, mockWhisperClient);
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok", service: "voice-transcription" });
	});

	it("auth enforcement still works (401 without token)", async () => {
		const app = createApp(testConfig, null as any, mockWhisperClient);
		const res = await app.request("/internal/transcribe", { method: "POST" });
		expect(res.status).toBe(401);
	});

	it("auth enforcement still works (403 for disallowed caller)", async () => {
		const token = await signServiceToken({
			issuer: "ai-router",
			audience: "voice-transcription",
			secret: JWT_SECRET,
		});
		const app = createApp(testConfig, null as any, mockWhisperClient);
		const res = await app.request("/internal/transcribe", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});
});
