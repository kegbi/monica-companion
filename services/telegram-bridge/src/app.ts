import { correlationId, serviceAuth } from "@monica-companion/auth";
import { otelMiddleware } from "@monica-companion/observability";
import { OutboundMessageIntentSchema } from "@monica-companion/types";
import { Bot } from "grammy";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type Redis from "ioredis";
import type { BotContext } from "./bot/context";
import { renderOutbound } from "./bot/outbound-renderer";
import { setupBot } from "./bot/setup";
import { UpdateDedup } from "./bot/update-dedup";
import { createWebhookHandler } from "./bot/webhook-handler";
import type { Config } from "./config";
import { createAiRouterClient } from "./lib/ai-router-client";
import { TelegramFileFetcher } from "./lib/telegram-file-fetcher";
import { createUserManagementClient } from "./lib/user-management-client";
import { createVoiceTranscriptionClient } from "./lib/voice-transcription-client";
import { rateLimiter } from "./middleware/rate-limiter";
import { webhookSecret } from "./middleware/webhook-secret";

export function createApp(config: Config, redis?: Redis) {
	const app = new Hono();

	app.use(otelMiddleware());

	app.get("/health", correlationId(), (c) => c.json({ status: "ok", service: "telegram-bridge" }));

	// Create bot instance
	const bot = new Bot<BotContext>(config.telegramBotToken);

	// Create service clients
	const userManagementClient = createUserManagementClient({
		baseUrl: config.userManagementUrl,
		secret: config.auth.jwtSecrets[0],
		timeoutMs: config.userManagementTimeoutMs,
	});

	const aiRouterClient = createAiRouterClient({
		baseUrl: config.aiRouterUrl,
		secret: config.auth.jwtSecrets[0],
		timeoutMs: config.aiRouterTimeoutMs,
	});

	const voiceTranscriptionClient = createVoiceTranscriptionClient({
		baseUrl: config.voiceTranscriptionUrl,
		secret: config.auth.jwtSecrets[0],
		timeoutMs: config.voiceTranscriptionTimeoutMs,
	});

	const fileFetcher = new TelegramFileFetcher(config.telegramBotToken);

	// Setup bot middleware and handlers
	setupBot(bot, {
		lookupUser: async (connectorUserId) => {
			const result = await userManagementClient.lookupByConnector("telegram", connectorUserId);
			if (result.found && result.userId) {
				return { found: true, userId: result.userId };
			}
			return { found: false };
		},
		forwardEvent: (event) => aiRouterClient.forwardEvent(event),
		downloadFile: (fileId) => fileFetcher.downloadFile(fileId),
		transcribe: (metadata, buffer, userId) =>
			voiceTranscriptionClient.transcribe(metadata, buffer, userId),
	});

	// Create update dedup (uses Redis if available)
	const dedup = redis
		? new UpdateDedup(redis)
		: new UpdateDedup({ set: async () => "OK" } as never);

	// Webhook endpoint
	const webhook = new Hono();
	webhook.use(
		rateLimiter({
			windowMs: config.rateLimitWindowMs,
			maxRequests: config.rateLimitMaxRequests,
		}),
	);
	webhook.use(webhookSecret(config.telegramWebhookSecret));
	webhook.use(bodyLimit({ maxSize: 256 * 1024 }));
	webhook.post("/telegram", createWebhookHandler(bot, dedup));

	app.route("/webhook", webhook);

	// Internal send endpoint (caller: delivery only)
	const internal = new Hono();
	internal.use(
		serviceAuth({
			audience: "telegram-bridge",
			secrets: config.auth.jwtSecrets,
			allowedCallers: ["delivery"],
		}),
	);
	internal.post("/send", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = OutboundMessageIntentSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid payload" }, 400);
		}

		try {
			await renderOutbound(bot.api, parsed.data);
			return c.json({ ok: true });
		} catch {
			return c.json({ error: "Failed to send message" }, 500);
		}
	});

	app.route("/internal", internal);

	return app;
}
