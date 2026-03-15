import { timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";

export function webhookSecret(expectedSecret: string) {
	const expected = Buffer.from(expectedSecret);

	return createMiddleware(async (c, next) => {
		const header = c.req.header("x-telegram-bot-api-secret-token");
		if (!header) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const provided = Buffer.from(header);
		if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		await next();
	});
}
