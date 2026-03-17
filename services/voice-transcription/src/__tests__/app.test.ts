import { signServiceToken } from "@monica-companion/auth";
import { describe, expect, it, vi } from "vitest";

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

import { createApp } from "../app";

const JWT_SECRET = "test-secret-256-bit-minimum-key!";

const testConfig = {
	auth: {
		serviceName: "voice-transcription" as const,
		jwtSecrets: [JWT_SECRET],
	},
	openaiApiKey: "sk-test-key",
	whisperModel: "whisper-1",
	whisperTimeoutMs: 60000,
	whisperMaxFileSizeBytes: 25 * 1024 * 1024,
	fetchUrlTimeoutMs: 15000,
	whisperCostPerMinuteUsd: 0.006,
	redisUrl: "redis://localhost:6379",
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

const mockWhisperClient = {
	transcribe: vi.fn().mockResolvedValue({
		text: "Test transcription",
		detectedLanguage: "en",
	}),
};

describe("voice-transcription app", () => {
	it("GET /health returns 200", async () => {
		const app = createApp(testConfig, null as any, mockWhisperClient);
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok", service: "voice-transcription" });
	});

	it("POST /internal/transcribe returns 401 without auth", async () => {
		const app = createApp(testConfig, null as any, mockWhisperClient);
		const res = await app.request("/internal/transcribe", { method: "POST" });
		expect(res.status).toBe(401);
	});

	it("POST /internal/transcribe returns 403 for disallowed caller", async () => {
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

	it("POST /internal/transcribe returns transcription for valid request from telegram-bridge", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "voice-transcription",
			secret: JWT_SECRET,
			correlationId: "corr-test",
			subject: "user-123",
		});
		const app = createApp(testConfig, null as any, mockWhisperClient);

		const formData = new FormData();
		formData.append(
			"metadata",
			JSON.stringify({
				mimeType: "audio/ogg",
				durationSeconds: 5,
				correlationId: "corr-test",
			}),
		);
		formData.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }));

		const res = await app.request("/internal/transcribe", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: formData,
		});
		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.text).toBe("Test transcription");
		expect(body.correlationId).toBe("corr-test");
	});
});
