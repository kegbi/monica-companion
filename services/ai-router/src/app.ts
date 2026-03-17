import {
	createGuardrailMetrics,
	type GuardrailMetrics,
	guardrailMiddleware,
} from "@monica-companion/guardrails";
import { otelMiddleware } from "@monica-companion/observability";
import { Hono } from "hono";
import type Redis from "ioredis";
import type { Config } from "./config.js";
import { contactResolutionRoutes } from "./contact-resolution/routes.js";
import type { Database } from "./db/connection.js";

export function createApp(config: Config, _db: Database, redis: Redis) {
	const app = new Hono();
	const metrics: GuardrailMetrics = createGuardrailMetrics();

	app.use(otelMiddleware());

	app.get("/health", (c) => c.json({ status: "ok", service: "ai-router" }));

	// Apply guardrail middleware to all internal routes (GPT-calling routes)
	const guard = guardrailMiddleware({
		redis,
		modelType: "gpt",
		rateLimit: config.guardrails.rateLimitPerUser,
		rateWindowSeconds: config.guardrails.rateWindowSeconds,
		maxConcurrency: config.guardrails.concurrencyPerUser,
		budgetLimitUsd: config.guardrails.budgetLimitUsd,
		budgetAlarmThresholdPct: config.guardrails.budgetAlarmThresholdPct,
		costEstimator: () => config.guardrails.costPerRequestUsd,
		metrics,
		service: "ai-router",
	});

	app.use("/internal/*", guard);

	// Mount contact resolution routes under /internal
	app.route("/internal", contactResolutionRoutes(config));

	return app;
}
