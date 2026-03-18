import { serviceAuth } from "@monica-companion/auth";
import { createGuardrailMetrics, guardrailMiddleware } from "@monica-companion/guardrails";
import { otelMiddleware } from "@monica-companion/observability";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type Redis from "ioredis";
import type { Config } from "./config";
import { createTranscriptionHandler } from "./transcription-handler";
import type { WhisperClient } from "./whisper-client";

export function createApp(config: Config, redis: Redis, whisperClient: WhisperClient) {
	const app = new Hono();
	const metrics = createGuardrailMetrics();

	app.use(otelMiddleware());

	app.get("/health", (c) => c.json({ status: "ok", service: "voice-transcription" }));

	const internal = new Hono();
	internal.use(
		serviceAuth({
			audience: "voice-transcription",
			secrets: config.auth.jwtSecrets,
			allowedCallers: config.inboundAllowedCallers,
		}),
	);

	// 25MB body limit
	internal.use(bodyLimit({ maxSize: 25 * 1024 * 1024 }));

	// Apply guardrail middleware with duration-based cost estimation (M2 finding)
	internal.use(
		"/transcribe",
		guardrailMiddleware({
			redis,
			modelType: "whisper",
			rateLimit: config.guardrails.rateLimitPerUser,
			rateWindowSeconds: config.guardrails.rateWindowSeconds,
			maxConcurrency: config.guardrails.concurrencyPerUser,
			budgetLimitUsd: config.guardrails.budgetLimitUsd,
			budgetAlarmThresholdPct: config.guardrails.budgetAlarmThresholdPct,
			costEstimator: () => {
				// Duration-based cost estimation per M2 finding
				// Default to 1 minute estimate when duration unknown
				return config.whisperCostPerMinuteUsd;
			},
			metrics,
			service: "voice-transcription",
		}),
	);

	const handler = createTranscriptionHandler({
		config,
		whisperClient,
	});

	internal.post("/transcribe", handler);

	app.route("/internal", internal);

	return app;
}
