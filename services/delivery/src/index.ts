import { createLogger } from "@monica-companion/observability";
import { telemetry } from "./instrumentation";

const logger = createLogger("delivery");

async function main() {
	const { serve } = await import("@hono/node-server");
	const { createApp } = await import("./app");

	const app = createApp();
	const port = Number(process.env.PORT) || 3006;

	serve({ fetch: app.fetch, port }, (info) => {
		logger.info(`delivery listening on :${info.port}`);
	});

	const shutdown = async () => {
		logger.info("Shutting down delivery");
		await telemetry.shutdown();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	logger.error("Failed to start delivery", {
		error: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
});
