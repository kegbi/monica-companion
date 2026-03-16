import { createLogger } from "@monica-companion/observability";
import { telemetry } from "./instrumentation";

const logger = createLogger("user-management");

async function main() {
	const { serve } = await import("@hono/node-server");
	const { createApp } = await import("./app");
	const { loadConfig } = await import("./config");
	const { createDb } = await import("./db/connection");

	const config = loadConfig();
	const db = createDb(config.databaseUrl);
	const app = createApp(config, db);

	serve({ fetch: app.fetch, port: config.port }, (info) => {
		logger.info(`user-management listening on :${info.port}`);
	});

	const shutdown = async () => {
		logger.info("Shutting down user-management");
		await telemetry.shutdown();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	logger.error("Failed to start user-management", {
		error: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
});
