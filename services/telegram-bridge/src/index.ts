import { createLogger } from "@monica-companion/observability";
import { telemetry } from "./instrumentation";

const logger = createLogger("telegram-bridge");

async function main() {
	const { serve } = await import("@hono/node-server");
	const { default: Redis } = await import("ioredis");
	const { createApp } = await import("./app");
	const { loadConfig } = await import("./config");

	const config = loadConfig();

	let redis: InstanceType<typeof Redis> | undefined;
	try {
		redis = new Redis(config.redisUrl);
	} catch {
		logger.warn("Failed to connect to Redis for update dedup -- proceeding without dedup");
	}

	const { app, bot } = createApp(config, redis);

	serve({ fetch: app.fetch, port: config.port }, (info) => {
		logger.info(`telegram-bridge listening on :${info.port}`);
	});

	if (config.telegramMode === "polling") {
		// Validate the bot token before starting polling
		try {
			const me = await bot.api.getMe();
			logger.info(`Bot authenticated as @${me.username} (${me.id})`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Telegram bot token is invalid or expired (${msg}). Get a new token from @BotFather.`,
			);
		}
		// bot.start() calls deleteWebhook internally before polling
		bot.start({
			onStart: () => logger.info("telegram-bridge polling started"),
		});
		logger.info("telegram-bridge running in POLLING mode (no public URL needed)");
	} else {
		logger.info("telegram-bridge running in WEBHOOK mode");
	}

	const shutdown = async () => {
		logger.info("Shutting down telegram-bridge");
		if (config.telegramMode === "polling") {
			await bot.stop();
		}
		if (redis) {
			await redis.quit();
		}
		await telemetry.shutdown();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	const msg = err instanceof Error ? err.message : String(err);
	logger.error("Failed to start telegram-bridge", { error: msg });
	console.error("[telegram-bridge] Fatal:", msg);
	process.exit(1);
});
