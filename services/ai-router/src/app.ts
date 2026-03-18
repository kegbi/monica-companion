import { serviceAuth } from "@monica-companion/auth";
import {
	createGuardrailMetrics,
	type GuardrailMetrics,
	guardrailMiddleware,
} from "@monica-companion/guardrails";
import { otelMiddleware } from "@monica-companion/observability";
import { redactString } from "@monica-companion/redaction";
import { InboundEventSchema } from "@monica-companion/types";
import { Hono } from "hono";
import type Redis from "ioredis";
import type { Config } from "./config.js";
import { contactResolutionRoutes } from "./contact-resolution/routes.js";
import type { Database } from "./db/connection.js";
import { getRecentTurns, insertTurnSummary } from "./db/turn-repository.js";
import { createConversationGraph } from "./graph/index.js";
import { getActivePendingCommandForUser } from "./pending-command/repository.js";

export function createApp(config: Config, db: Database, redis: Redis) {
	const app = new Hono();
	const metrics: GuardrailMetrics = createGuardrailMetrics();
	const graph = createConversationGraph({
		openaiApiKey: config.openaiApiKey,
		db,
		maxConversationTurns: config.maxConversationTurns,
		getRecentTurns,
		getActivePendingCommandForUser,
		insertTurnSummary,
		redactString,
	});

	app.use(otelMiddleware());

	// 1. Health check -- no middleware, stays guardrail-free
	app.get("/health", (c) => c.json({ status: "ok", service: "ai-router" }));

	// 2. Internal routes sub-app: auth → guardrails → handler (correct ordering)
	//    serviceAuth MUST run first so userId is in context before guardrails checks it.
	const internal = new Hono();
	internal.use(
		serviceAuth({
			audience: "ai-router",
			secrets: config.auth.jwtSecrets,
			allowedCallers: config.inboundAllowedCallers,
		}),
	);
	internal.use(
		"/process",
		guardrailMiddleware({
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
		}),
	);
	internal.post("/process", async (c) => {
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
	app.route("/internal", internal);

	// 3. Contact resolution routes (own per-endpoint auth, no LLM guardrails needed)
	app.route("/internal", contactResolutionRoutes(config));

	return app;
}
