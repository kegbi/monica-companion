import { createLogger } from "@monica-companion/observability";
import { telemetry } from "./instrumentation.js";

const logger = createLogger("ai-router");

async function main() {
	const { serve } = await import("@hono/node-server");
	const { createApp } = await import("./app.js");
	const { loadConfig } = await import("./config.js");
	const { createDb } = await import("./db/connection.js");
	const { startExpirySweep } = await import("./pending-command/expiry-sweep.js");

	const config = loadConfig();
	const db = createDb(config.databaseUrl);
	const app = createApp(config, db);

	const stopExpirySweep = startExpirySweep(db, config.expirySweepIntervalMs);

	const port = config.port;

	serve({ fetch: app.fetch, port }, (info) => {
		logger.info(`ai-router listening on :${info.port}`);
	});

	const shutdown = async () => {
		logger.info("Shutting down ai-router");
		stopExpirySweep();
		await telemetry.shutdown();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	logger.error("Failed to start ai-router", {
		error: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
});
