import { createLogger } from "@monica-companion/observability";
import { telemetry } from "./instrumentation";

const logger = createLogger("voice-transcription");

async function main() {
	const { serve } = await import("@hono/node-server");
	const { createApp } = await import("./app");
	const { loadConfig } = await import("./config");
	const { createRedisClient, closeRedisClient } = await import("@monica-companion/guardrails");
	const { createWhisperClient } = await import("./whisper-client");

	const config = loadConfig();

	// Create Redis client for guardrails
	const redis = createRedisClient(config.redisUrl);

	// Create Whisper client
	const whisperClient = createWhisperClient({
		apiKey: config.llmApiKey,
		baseUrl: config.llmBaseUrl,
		model: config.whisperModel,
		timeoutMs: config.whisperTimeoutMs,
	});

	const app = createApp(config, redis, whisperClient);
	const port = Number(process.env.PORT) || 3003;

	serve({ fetch: app.fetch, port }, (info) => {
		logger.info(`voice-transcription listening on :${info.port}`);
	});

	const shutdown = async () => {
		logger.info("Shutting down voice-transcription");
		await closeRedisClient(redis);
		await telemetry.shutdown();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	const msg = err instanceof Error ? err.message : String(err);
	logger.error("Failed to start voice-transcription", { error: msg });
	console.error("[voice-transcription] Fatal:", msg);
	process.exit(1);
});
