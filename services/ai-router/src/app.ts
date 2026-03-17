import { serviceAuth } from "@monica-companion/auth";
import {
	createGuardrailMetrics,
	type GuardrailMetrics,
	guardrailMiddleware,
} from "@monica-companion/guardrails";
import { otelMiddleware } from "@monica-companion/observability";
import { InboundEventSchema } from "@monica-companion/types";
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

	// Inbound event processing endpoint (caller: telegram-bridge)
	// Mounted before guardrail middleware to use its own auth
	const inbound = new Hono();
	inbound.use(
		serviceAuth({
			audience: "ai-router",
			secrets: config.auth.jwtSecrets,
			allowedCallers: ["telegram-bridge"],
		}),
	);
	inbound.post("/process", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = InboundEventSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid event payload" }, 400);
		}

		// Stub: acknowledge receipt, full processing deferred to AI Router task group
		return c.json({ received: true });
	});
	app.route("/internal", inbound);

	// Apply guardrail middleware to all other internal routes (GPT-calling routes)
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
