import { signServiceToken } from "@monica-companion/auth";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app";

const JWT_SECRET = "test-secret-256-bit-minimum-key!";

const testConfig = {
	telegramBridgeUrl: "http://telegram-bridge:3001",
	auth: {
		serviceName: "delivery" as const,
		jwtSecrets: [JWT_SECRET],
	},
};

describe("delivery app", () => {
	it("GET /health returns 200", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok", service: "delivery" });
	});

	it("POST /internal/deliver returns 401 without auth", async () => {
		const app = createApp(testConfig);
		const res = await app.request("/internal/deliver", { method: "POST" });
		expect(res.status).toBe(401);
	});

	it("POST /internal/deliver returns 403 for disallowed caller", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "delivery",
			secret: JWT_SECRET,
		});
		const app = createApp(testConfig);
		const res = await app.request("/internal/deliver", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(403);
	});

	it("POST /internal/deliver returns 400 for invalid payload", async () => {
		const token = await signServiceToken({
			issuer: "ai-router",
			audience: "delivery",
			secret: JWT_SECRET,
		});
		const app = createApp(testConfig);
		const res = await app.request("/internal/deliver", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ invalid: true }),
		});
		expect(res.status).toBe(400);
	});

	it("POST /internal/deliver forwards valid intent to connector URL", async () => {
		const token = await signServiceToken({
			issuer: "ai-router",
			audience: "delivery",
			secret: JWT_SECRET,
		});
		const mockFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
		const app = createApp({ ...testConfig, fetchFn: mockFetch as never });

		const intent = {
			userId: "user-uuid-123",
			connectorType: "telegram",
			connectorRoutingId: "chat-12345",
			correlationId: "corr-abc",
			content: { type: "text", text: "Hello!" },
		};

		const res = await app.request("/internal/deliver", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(intent),
		});
		expect(res.status).toBe(200);
		expect(mockFetch).toHaveBeenCalled();

		const fetchCall = mockFetch.mock.calls[0];
		expect(fetchCall[0]).toBe("http://telegram-bridge:3001/internal/send");
	});

	it("POST /internal/deliver accepts scheduler as allowed caller", async () => {
		const token = await signServiceToken({
			issuer: "scheduler",
			audience: "delivery",
			secret: JWT_SECRET,
		});
		const mockFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
		const app = createApp({ ...testConfig, fetchFn: mockFetch as never });

		const intent = {
			userId: "user-uuid-123",
			connectorType: "telegram",
			connectorRoutingId: "chat-12345",
			correlationId: "corr-abc",
			content: { type: "text", text: "Hello!" },
		};

		const res = await app.request("/internal/deliver", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(intent),
		});
		expect(res.status).toBe(200);
	});
});
