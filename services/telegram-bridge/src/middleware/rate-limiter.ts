import { createMiddleware } from "hono/factory";

interface RateLimiterOptions {
	windowMs: number;
	maxRequests: number;
}

interface WindowEntry {
	count: number;
	resetAt: number;
}

export function rateLimiter({ windowMs, maxRequests }: RateLimiterOptions) {
	const windows = new Map<string, WindowEntry>();

	const cleanup = setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of windows) {
			if (now >= entry.resetAt) {
				windows.delete(key);
			}
		}
	}, windowMs);
	cleanup.unref();

	return createMiddleware(async (c, next) => {
		const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
		const now = Date.now();

		let entry = windows.get(ip);
		if (!entry || now >= entry.resetAt) {
			entry = { count: 0, resetAt: now + windowMs };
			windows.set(ip, entry);
		}

		entry.count++;
		const remaining = Math.max(0, maxRequests - entry.count);

		c.header("X-RateLimit-Limit", String(maxRequests));
		c.header("X-RateLimit-Remaining", String(remaining));
		c.header("X-RateLimit-Reset", String(entry.resetAt));

		if (entry.count > maxRequests) {
			return c.json({ error: "Too Many Requests" }, 429);
		}

		await next();
	});
}
