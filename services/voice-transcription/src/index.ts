import { createLogger } from "@monica-companion/observability";
import { telemetry } from "./instrumentation";

const logger = createLogger("voice-transcription");

async function main() {
	const { serve } = await import("@hono/node-server");
	const { createApp } = await import("./app");
	const { loadConfig } = await import("./config");

	const config = loadConfig();
	const app = createApp(config);
	const port = Number(process.env.PORT) || 3003;

	serve({ fetch: app.fetch, port }, (info) => {
		logger.info(`voice-transcription listening on :${info.port}`);
	});

	const shutdown = async () => {
		logger.info("Shutting down voice-transcription");
		await telemetry.shutdown();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	logger.error("Failed to start voice-transcription", {
		error: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
});
