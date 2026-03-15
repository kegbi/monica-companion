import { describe, expect, it, vi } from "vitest";
import { createServiceClient } from "../client";
import { verifyServiceToken } from "../token";

const SECRET = "test-secret-256-bit-minimum-key!";

function createMockFetch() {
	let captured: { url: string; init?: RequestInit } | null = null;

	const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		captured = {
			url: typeof input === "string" ? input : input.toString(),
			init,
		};
		return new Response(JSON.stringify({ ok: true }), { status: 200 });
	});

	function headers(): Headers {
		return new Headers(captured?.init?.headers);
	}

	function authToken(): string {
		const auth = headers().get("Authorization") ?? "";
		return auth.replace("Bearer ", "");
	}

	return {
		fn,
		headers,
		authToken,
		get captured() {
			return captured;
		},
	};
}

describe("createServiceClient", () => {
	it("attaches Authorization Bearer header to requests", async () => {
		const mock = createMockFetch();
		const client = createServiceClient({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
			baseUrl: "http://ai-router:3002",
			fetch: mock.fn,
		});

		await client.fetch("/api/test");

		expect(mock.fn).toHaveBeenCalledOnce();
		expect(mock.headers().get("Authorization")).toMatch(/^Bearer .+/);

		const payload = await verifyServiceToken({
			token: mock.authToken(),
			audience: "ai-router",
			secrets: [SECRET],
		});
		expect(payload.iss).toBe("telegram-bridge");
		expect(payload.aud).toBe("ai-router");
	});

	it("attaches X-Correlation-ID header when provided", async () => {
		const mock = createMockFetch();
		const client = createServiceClient({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
			baseUrl: "http://ai-router:3002",
			fetch: mock.fn,
		});

		await client.fetch("/api/test", { correlationId: "corr-123" });

		expect(mock.headers().get("X-Correlation-ID")).toBe("corr-123");
	});

	it("includes subject in JWT when userId provided", async () => {
		const mock = createMockFetch();
		const client = createServiceClient({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
			baseUrl: "http://ai-router:3002",
			fetch: mock.fn,
		});

		await client.fetch("/api/test", { userId: "user-42" });

		const payload = await verifyServiceToken({
			token: mock.authToken(),
			audience: "ai-router",
			secrets: [SECRET],
		});
		expect(payload.sub).toBe("user-42");
	});

	it("constructs full URL from baseUrl and path", async () => {
		const mock = createMockFetch();
		const client = createServiceClient({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
			baseUrl: "http://ai-router:3002",
			fetch: mock.fn,
		});

		await client.fetch("/api/contacts/search");

		expect(mock.captured?.url).toBe("http://ai-router:3002/api/contacts/search");
	});

	it("passes through request init options", async () => {
		const mock = createMockFetch();
		const client = createServiceClient({
			issuer: "scheduler",
			audience: "delivery",
			secret: SECRET,
			baseUrl: "http://delivery:3006",
			fetch: mock.fn,
		});

		await client.fetch("/api/send", {
			method: "POST",
			body: JSON.stringify({ message: "hello" }),
		});

		expect(mock.captured?.init?.method).toBe("POST");
		expect(mock.captured?.init?.body).toBe(JSON.stringify({ message: "hello" }));
	});

	it("signs a fresh token per request", async () => {
		const tokens: string[] = [];

		const mockFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			const auth = headers.get("Authorization") ?? "";
			tokens.push(auth.replace("Bearer ", ""));
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		});

		const client = createServiceClient({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
			baseUrl: "http://ai-router:3002",
			fetch: mockFetch,
		});

		await client.fetch("/api/test");
		await client.fetch("/api/test");

		expect(tokens).toHaveLength(2);
		expect(tokens[0]).not.toBe(tokens[1]);
	});

	it("merges custom headers with auth headers", async () => {
		const mock = createMockFetch();
		const client = createServiceClient({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
			baseUrl: "http://ai-router:3002",
			fetch: mock.fn,
		});

		await client.fetch("/api/test", {
			headers: { "Content-Type": "application/json" },
		});

		expect(mock.headers().get("Content-Type")).toBe("application/json");
		expect(mock.headers().get("Authorization")).toMatch(/^Bearer .+/);
	});
});
