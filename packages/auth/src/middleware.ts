import { randomUUID } from "node:crypto";
import { createMiddleware } from "hono/factory";
import type { ServiceName, ServiceTokenPayload } from "./schemas";
import { verifyServiceToken } from "./token";

export interface ServiceAuthOptions {
	audience: ServiceName;
	secrets: string[];
	allowedCallers: string[];
}

export function serviceAuth(options: ServiceAuthOptions) {
	const { audience, secrets, allowedCallers } = options;

	return createMiddleware(async (c, next) => {
		const authHeader = c.req.header("authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			return c.json({ error: "Missing or invalid Authorization header" }, 401);
		}

		const token = authHeader.slice(7);
		if (!token) {
			return c.json({ error: "Missing or invalid Authorization header" }, 401);
		}

		let payload: ServiceTokenPayload;
		try {
			payload = await verifyServiceToken({ token, audience, secrets });
		} catch {
			return c.json({ error: "Invalid or expired token" }, 401);
		}

		if (!allowedCallers.includes(payload.iss)) {
			return c.json({ error: "Caller not allowed" }, 403);
		}

		const correlationId = payload.cid || randomUUID();

		c.set("serviceCaller", payload.iss);
		c.set("userId", payload.sub);
		c.set("correlationId", correlationId);
		c.header("X-Correlation-ID", correlationId);

		await next();
	});
}

export function correlationId() {
	return createMiddleware(async (c, next) => {
		const cid = c.req.header("x-correlation-id") || randomUUID();
		c.set("correlationId", cid);
		c.header("X-Correlation-ID", cid);
		await next();
	});
}
