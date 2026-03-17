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

	const app = createApp(config, redis);

	serve({ fetch: app.fetch, port: config.port }, (info) => {
		logger.info(`telegram-bridge listening on :${info.port}`);
	});

	const shutdown = async () => {
		logger.info("Shutting down telegram-bridge");
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
	logger.error("Failed to start telegram-bridge", {
		error: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
});
