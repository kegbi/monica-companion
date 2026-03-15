import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimiter } from "../middleware/rate-limiter";

function createTestApp(opts: { windowMs: number; maxRequests: number }) {
	const app = new Hono();
	app.use("/webhook/*", rateLimiter(opts));
	app.post("/webhook/telegram", (c) => c.json({ ok: true }));
	return app;
}

function makeRequest(app: Hono, ip = "203.0.113.1") {
	return app.request("/webhook/telegram", {
		method: "POST",
		headers: { "x-forwarded-for": ip },
	});
}

describe("rateLimiter middleware", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("allows requests under the limit", async () => {
		const app = createTestApp({ windowMs: 60_000, maxRequests: 3 });

		const res1 = await makeRequest(app);
		expect(res1.status).toBe(200);
		expect(res1.headers.get("x-ratelimit-limit")).toBe("3");
		expect(res1.headers.get("x-ratelimit-remaining")).toBe("2");

		const res2 = await makeRequest(app);
		expect(res2.status).toBe(200);
		expect(res2.headers.get("x-ratelimit-remaining")).toBe("1");
	});

	it("returns 429 when limit is exceeded", async () => {
		const app = createTestApp({ windowMs: 60_000, maxRequests: 2 });

		await makeRequest(app);
		await makeRequest(app);
		const res = await makeRequest(app);

		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body).toEqual({ error: "Too Many Requests" });
		expect(res.headers.get("x-ratelimit-remaining")).toBe("0");
	});

	it("resets counter after window expires", async () => {
		const app = createTestApp({ windowMs: 60_000, maxRequests: 1 });

		const res1 = await makeRequest(app);
		expect(res1.status).toBe(200);

		const res2 = await makeRequest(app);
		expect(res2.status).toBe(429);

		vi.advanceTimersByTime(60_001);

		const res3 = await makeRequest(app);
		expect(res3.status).toBe(200);
	});

	it("tracks different IPs independently", async () => {
		const app = createTestApp({ windowMs: 60_000, maxRequests: 1 });

		const res1 = await makeRequest(app, "10.0.0.1");
		expect(res1.status).toBe(200);

		const res2 = await makeRequest(app, "10.0.0.2");
		expect(res2.status).toBe(200);

		const res3 = await makeRequest(app, "10.0.0.1");
		expect(res3.status).toBe(429);
	});

	it("sets X-RateLimit-Reset header", async () => {
		const app = createTestApp({ windowMs: 60_000, maxRequests: 5 });

		const res = await makeRequest(app);
		const resetHeader = res.headers.get("x-ratelimit-reset");
		expect(resetHeader).toBeTruthy();
		const resetTime = Number(resetHeader);
		expect(resetTime).toBeGreaterThan(Date.now());
	});

	it("uses 'unknown' key when no IP is available", async () => {
		const app = createTestApp({ windowMs: 60_000, maxRequests: 1 });

		const res1 = await app.request("/webhook/telegram", { method: "POST" });
		expect(res1.status).toBe(200);

		const res2 = await app.request("/webhook/telegram", { method: "POST" });
		expect(res2.status).toBe(429);
	});
});
