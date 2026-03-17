import { signServiceToken } from "@monica-companion/auth";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";

const JWT_SECRET = "test-secret-256-bit-minimum-key!";

const testConfig = {
	auth: {
		serviceName: "voice-transcription" as const,
		jwtSecrets: [JWT_SECRET],
	},
};

describe("voice-transcription app", () => {
	it("GET /health returns 200", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok", service: "voice-transcription" });
	});

	it("POST /internal/transcribe returns 401 without auth", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/internal/transcribe", { method: "POST" });
		expect(res.status).toBe(401);
	});

	it("POST /internal/transcribe returns 403 for disallowed caller", async () => {
		const token = await signServiceToken({
			issuer: "ai-router",
			audience: "voice-transcription",
			secret: JWT_SECRET,
		});
		const app = createApp(testConfig);
		const res = await app.request("/internal/transcribe", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});

	it("POST /internal/transcribe returns stub error for valid request from telegram-bridge", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "voice-transcription",
			secret: JWT_SECRET,
			correlationId: "corr-test",
		});
		const app = createApp(testConfig);

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
		expect(body.success).toBe(false);
		expect(body.error).toBe("Transcription not implemented");
		expect(body.correlationId).toBe("corr-test");
	});
});
