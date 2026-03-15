import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Config } from "./config";
import { rateLimiter } from "./middleware/rate-limiter";
import { webhookSecret } from "./middleware/webhook-secret";

export function createApp(config: Config) {
	const app = new Hono();

	app.get("/health", (c) => c.json({ status: "ok", service: "telegram-bridge" }));

	const webhook = new Hono();
	webhook.use(
		rateLimiter({
			windowMs: config.rateLimitWindowMs,
			maxRequests: config.rateLimitMaxRequests,
		}),
	);
	webhook.use(webhookSecret(config.telegramWebhookSecret));
	webhook.use(bodyLimit({ maxSize: 256 * 1024 }));
	webhook.post("/telegram", (c) => c.json({ ok: true }));

	app.route("/webhook", webhook);

	return app;
}
