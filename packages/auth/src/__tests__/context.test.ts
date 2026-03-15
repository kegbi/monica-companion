import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { getCorrelationId, getServiceCaller, getUserId } from "../context";

describe("context helpers", () => {
	it("getServiceCaller returns the stored caller", async () => {
		const app = new Hono();
		app.use((c, next) => {
			c.set("serviceCaller", "delivery");
			return next();
		});
		app.get("/test", (c) => c.json({ caller: getServiceCaller(c) }));

		const res = await app.request("/test");
		const body = await res.json();
		expect(body.caller).toBe("delivery");
	});

	it("getUserId returns the stored user ID", async () => {
		const app = new Hono();
		app.use((c, next) => {
			c.set("userId", "user-123");
			return next();
		});
		app.get("/test", (c) => c.json({ userId: getUserId(c) }));

		const res = await app.request("/test");
		const body = await res.json();
		expect(body.userId).toBe("user-123");
	});

	it("getUserId returns undefined when not set", async () => {
		const app = new Hono();
		app.get("/test", (c) => c.json({ userId: getUserId(c) ?? null }));

		const res = await app.request("/test");
		const body = await res.json();
		expect(body.userId).toBeNull();
	});

	it("getCorrelationId returns the stored correlation ID", async () => {
		const app = new Hono();
		app.use((c, next) => {
			c.set("correlationId", "corr-456");
			return next();
		});
		app.get("/test", (c) => c.json({ cid: getCorrelationId(c) }));

		const res = await app.request("/test");
		const body = await res.json();
		expect(body.cid).toBe("corr-456");
	});
});
