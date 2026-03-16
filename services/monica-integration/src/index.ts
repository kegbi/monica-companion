import { createLogger } from "@monica-companion/observability";
import { telemetry } from "./instrumentation";

const logger = createLogger("monica-integration");

async function main() {
	const { serve } = await import("@hono/node-server");
	const { createApp } = await import("./app");
	const { loadConfig } = await import("./config");

	const config = loadConfig();
	const app = createApp(config);

	serve({ fetch: app.fetch, port: config.port }, (info) => {
		logger.info(`monica-integration listening on :${info.port}`);
	});

	const shutdown = async () => {
		logger.info("Shutting down monica-integration");
		await telemetry.shutdown();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	logger.error("Failed to start monica-integration", {
		error: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
});
