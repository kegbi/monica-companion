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
import { createConversationGraph } from "./graph/index.js";

export function createApp(config: Config, _db: Database, redis: Redis) {
	const app = new Hono();
	const metrics: GuardrailMetrics = createGuardrailMetrics();
	const graph = createConversationGraph({ openaiApiKey: config.openaiApiKey });

	app.use(otelMiddleware());

	// 1. Health check -- no middleware, stays guardrail-free
	app.get("/health", (c) => c.json({ status: "ok", service: "ai-router" }));

	// 2. Guardrail middleware for all /internal/* routes
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

	// 3. Inbound event processing -- behind BOTH guardrails AND service auth
	const processRoutes = new Hono();
	processRoutes.use(
		serviceAuth({
			audience: "ai-router",
			secrets: config.auth.jwtSecrets,
			allowedCallers: config.inboundAllowedCallers,
		}),
	);
	processRoutes.post("/process", async (c) => {
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

		const event = parsed.data;

		try {
			const result = await graph.invoke({
				userId: event.userId,
				correlationId: event.correlationId,
				inboundEvent: event,
			});

			if (!result.response) {
				return c.json({ type: "error", text: "No response generated" }, 500);
			}

			return c.json(result.response);
		} catch (err) {
			console.error(
				`[ai-router] Graph invocation failed correlationId=${event.correlationId}`,
				err instanceof Error ? err.message : "unknown error",
			);
			return c.json({ type: "error", text: "Failed to process event" }, 500);
		}
	});
	app.route("/internal", processRoutes);

	// 4. Contact resolution routes under /internal (existing, unchanged)
	app.route("/internal", contactResolutionRoutes(config));

	return app;
}
