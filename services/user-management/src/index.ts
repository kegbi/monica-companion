import { createServiceClient } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";
import { telemetry } from "./instrumentation";

const logger = createLogger("user-management");

async function main() {
	const { serve } = await import("@hono/node-server");
	const { createApp } = await import("./app");
	const { loadConfig } = await import("./config");
	const { createDb } = await import("./db/connection");
	const { processPendingPurges } = await import("./purge/executor");

	const config = loadConfig();
	const db = createDb(config.databaseUrl);
	const app = createApp(config, db);

	// Create service clients for purge executor
	const jwtSecret = config.auth.jwtSecrets[0];

	const aiRouterClient = createServiceClient({
		issuer: "user-management",
		audience: "ai-router",
		secret: jwtSecret,
		baseUrl: config.aiRouterUrl,
	});

	const schedulerClient = createServiceClient({
		issuer: "user-management",
		audience: "scheduler",
		secret: jwtSecret,
		baseUrl: config.schedulerUrl,
	});

	const deliveryClient = createServiceClient({
		issuer: "user-management",
		audience: "delivery",
		secret: jwtSecret,
		baseUrl: config.deliveryUrl,
	});

	// Start purge sweep timer
	const purgeSweepInterval = setInterval(async () => {
		try {
			await processPendingPurges({
				config,
				db,
				aiRouterClient,
				schedulerClient,
				deliveryClient,
			});
		} catch (err) {
			logger.error("Purge sweep failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}, config.purgeSweepIntervalMs);

	serve({ fetch: app.fetch, port: config.port }, (info) => {
		logger.info(`user-management listening on :${info.port}`);
	});

	const shutdown = async () => {
		logger.info("Shutting down user-management");
		clearInterval(purgeSweepInterval);
		await telemetry.shutdown();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	const msg = err instanceof Error ? err.message : String(err);
	logger.error("Failed to start user-management", { error: msg });
	console.error("[user-management] Fatal:", msg);
	process.exit(1);
});
