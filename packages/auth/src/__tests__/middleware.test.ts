import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { getCorrelationId, getServiceCaller, getUserId } from "../context";
import { correlationId, serviceAuth } from "../middleware";
import { signServiceToken } from "../token";

const SECRET = "test-secret-256-bit-minimum-key!";
const SECRET_OLD = "old-secret-256-bit-minimum-key!!";

function createAuthApp(allowedCallers: string[] = ["telegram-bridge"]) {
	const app = new Hono();
	app.use(
		"/api/*",
		serviceAuth({
			audience: "ai-router",
			secrets: [SECRET],
			allowedCallers,
		}),
	);
	app.get("/api/test", (c) =>
		c.json({
			caller: getServiceCaller(c),
			userId: getUserId(c) ?? null,
			correlationId: getCorrelationId(c),
		}),
	);
	app.get("/health", (c) => c.json({ status: "ok" }));
	return app;
}

describe("serviceAuth middleware", () => {
	it("returns 401 when no Authorization header", async () => {
		const app = createAuthApp();
		const res = await app.request("/api/test");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe("Missing or invalid Authorization header");
	});

	it("returns 401 when Authorization header is not Bearer", async () => {
		const app = createAuthApp();
		const res = await app.request("/api/test", {
			headers: { Authorization: "Basic abc123" },
		});
		expect(res.status).toBe(401);
	});

	it("returns 401 when Bearer token is empty", async () => {
		const app = createAuthApp();
		const res = await app.request("/api/test", {
			headers: { Authorization: "Bearer " },
		});
		expect(res.status).toBe(401);
	});

	it("returns 401 when token has invalid signature", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: "wrong-secret-that-is-long-enough",
		});
		const app = createAuthApp();
		const res = await app.request("/api/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe("Invalid or expired token");
	});

	it("returns 401 when token audience does not match", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "scheduler",
			secret: SECRET,
		});
		const app = createAuthApp();
		const res = await app.request("/api/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(401);
	});

	it("returns 403 when caller is not in allowedCallers", async () => {
		const token = await signServiceToken({
			issuer: "scheduler",
			audience: "ai-router",
			secret: SECRET,
		});
		const app = createAuthApp(["telegram-bridge"]); // scheduler not allowed
		const res = await app.request("/api/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error).toBe("Caller not allowed");
	});

	it("returns 200 and sets context for valid token from allowed caller", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
			subject: "user-42",
			correlationId: "corr-001",
		});
		const app = createAuthApp();
		const res = await app.request("/api/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.caller).toBe("telegram-bridge");
		expect(body.userId).toBe("user-42");
		expect(body.correlationId).toBe("corr-001");
	});

	it("generates correlationId when not in token", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
		});
		const app = createAuthApp();
		const res = await app.request("/api/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.correlationId).toBeDefined();
		expect(typeof body.correlationId).toBe("string");
		expect(body.correlationId.length).toBeGreaterThan(0);
	});

	it("accepts token signed with previous secret (rotation)", async () => {
		const app = new Hono();
		app.use(
			"/api/*",
			serviceAuth({
				audience: "ai-router",
				secrets: [SECRET, SECRET_OLD],
				allowedCallers: ["telegram-bridge"],
			}),
		);
		app.get("/api/test", (c) => c.json({ ok: true }));

		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET_OLD,
		});
		const res = await app.request("/api/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
	});

	it("does not affect non-protected routes", async () => {
		const app = createAuthApp();
		const res = await app.request("/health");
		expect(res.status).toBe(200);
	});

	it("sets X-Correlation-ID response header", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
			correlationId: "trace-123",
		});
		const app = createAuthApp();
		const res = await app.request("/api/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.headers.get("X-Correlation-ID")).toBe("trace-123");
	});
});

describe("correlationId middleware", () => {
	function createCidApp() {
		const app = new Hono();
		app.use(correlationId());
		app.get("/health", (c) => c.json({ cid: getCorrelationId(c) }));
		return app;
	}

	it("uses X-Correlation-ID from request header", async () => {
		const app = createCidApp();
		const res = await app.request("/health", {
			headers: { "X-Correlation-ID": "incoming-123" },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.cid).toBe("incoming-123");
		expect(res.headers.get("X-Correlation-ID")).toBe("incoming-123");
	});

	it("generates UUID when no header provided", async () => {
		const app = createCidApp();
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.cid).toBeDefined();
		expect(body.cid.length).toBeGreaterThan(0);
		expect(res.headers.get("X-Correlation-ID")).toBe(body.cid);
	});

	it("generates unique IDs per request", async () => {
		const app = createCidApp();
		const res1 = await app.request("/health");
		const res2 = await app.request("/health");
		const body1 = await res1.json();
		const body2 = await res2.json();
		expect(body1.cid).not.toBe(body2.cid);
	});
});
