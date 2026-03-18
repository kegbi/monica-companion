import { createLogger } from "@monica-companion/observability";
import { telemetry } from "./instrumentation";

const logger = createLogger("delivery");

async function main() {
	const { serve } = await import("@hono/node-server");
	const { createApp } = await import("./app");
	const { loadConfig } = await import("./config");
	const { createDb } = await import("./db/connection");

	const config = loadConfig();
	const { db, sql } = createDb(config.databaseUrl);
	const app = createApp(config, { db });
	const port = Number(process.env.PORT) || 3006;

	serve({ fetch: app.fetch, port }, (info) => {
		logger.info(`delivery listening on :${info.port}`);
	});

	const shutdown = async () => {
		logger.info("Shutting down delivery");
		await sql.end();
		await telemetry.shutdown();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	const msg = err instanceof Error ? err.message : String(err);
	logger.error("Failed to start delivery", { error: msg });
	console.error("[delivery] Fatal:", msg);
	process.exit(1);
});
