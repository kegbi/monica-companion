import { createServiceClient, serviceAuth } from "@monica-companion/auth";
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
import { createDeliveryClient } from "./lib/delivery-client.js";
import { createSchedulerClient } from "./lib/scheduler-client.js";
import { createUserManagementClient } from "./lib/user-management-client.js";
import {
	createPendingCommand,
	getActivePendingCommandForUser,
	getPendingCommand,
	transitionStatus,
	updateDraftPayload,
} from "./pending-command/repository.js";
import { retentionRoutes } from "./retention/routes.js";
import { userPurgeRoutes } from "./retention/user-purge-routes.js";

export function createApp(config: Config, db: Database, redis: Redis) {
	const app = new Hono();
	const metrics: GuardrailMetrics = createGuardrailMetrics();

	// Create service clients for downstream services
	const jwtSecret = config.auth.jwtSecrets[0];

	const deliveryServiceClient = createServiceClient({
		issuer: "ai-router",
		audience: "delivery",
		secret: jwtSecret,
		baseUrl: config.deliveryUrl,
	});

	const schedulerServiceClient = createServiceClient({
		issuer: "ai-router",
		audience: "scheduler",
		secret: jwtSecret,
		baseUrl: config.schedulerUrl,
	});

	const userManagementServiceClient = createServiceClient({
		issuer: "ai-router",
		audience: "user-management",
		secret: jwtSecret,
		baseUrl: config.userManagementUrl,
	});

	const deliveryClient = createDeliveryClient(deliveryServiceClient);
	const schedulerClient = createSchedulerClient(schedulerServiceClient);
	const userManagementClient = createUserManagementClient(userManagementServiceClient);

	const graph = createConversationGraph({
		openaiApiKey: config.openaiApiKey,
		db,
		maxConversationTurns: config.maxConversationTurns,
		pendingCommandTtlMinutes: config.pendingCommandTtlMinutes,
		autoConfirmConfidenceThreshold: config.autoConfirmConfidenceThreshold,
		getRecentTurns,
		getActivePendingCommandForUser,
		insertTurnSummary,
		redactString,
		createPendingCommand,
		transitionStatus,
		getPendingCommand,
		updateDraftPayload,
		schedulerClient,
		deliveryClient,
		userManagementClient,
	});

	app.use(otelMiddleware());

	// 1. Health check -- no middleware, stays guardrail-free
	app.get("/health", (c) => c.json({ status: "ok", service: "ai-router" }));

	// 2. Internal routes sub-app: auth → guardrails → handler (correct ordering)
	//    serviceAuth MUST run first so userId is in context before guardrails checks it.
	//    Auth is scoped to /process so it does not collide with other sub-apps mounted at /internal.
	const internal = new Hono();
	internal.use(
		"/process",
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

	// 4. Retention cleanup routes (own per-endpoint auth, caller: scheduler only)
	app.route("/internal", retentionRoutes(config, db));

	// 5. User data purge routes (own per-endpoint auth, caller: user-management only)
	app.route("/internal", userPurgeRoutes(config, db));

	return app;
}
