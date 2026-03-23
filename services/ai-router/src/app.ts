import { createServiceClient, serviceAuth } from "@monica-companion/auth";
import {
	createGuardrailMetrics,
	type GuardrailMetrics,
	guardrailMiddleware,
} from "@monica-companion/guardrails";
import { createLogger, otelMiddleware } from "@monica-companion/observability";
import { InboundEventSchema } from "@monica-companion/types";
import { trace } from "@opentelemetry/api";
import { Hono } from "hono";
import type Redis from "ioredis";
import { z } from "zod/v4";
import { clearHistory, getHistory, saveHistory } from "./agent/history-repository.js";
import { createLlmClient } from "./agent/llm-client.js";
import { runAgentLoop } from "./agent/loop.js";
import type { Config } from "./config.js";
import { contactResolutionRoutes } from "./contact-resolution/routes.js";
import type { Database } from "./db/connection.js";
import { createDeliveryClient } from "./lib/delivery-client.js";
import { createSchedulerClient } from "./lib/scheduler-client.js";
import { createUserManagementClient } from "./lib/user-management-client.js";
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

	const monicaIntegrationServiceClient = createServiceClient({
		issuer: "ai-router",
		audience: "monica-integration",
		secret: jwtSecret,
		baseUrl: config.monicaIntegrationUrl,
	});

	const deliveryClient = createDeliveryClient(deliveryServiceClient);
	const schedulerClient = createSchedulerClient(schedulerServiceClient);
	const userManagementClient = createUserManagementClient(userManagementServiceClient);

	// Create LLM client for agent loop
	const llmClient = createLlmClient({
		baseUrl: config.llmBaseUrl,
		apiKey: config.llmApiKey,
		modelId: config.llmModelId,
	});

	const agentDeps = {
		llmClient,
		db,
		getHistory,
		saveHistory,
		pendingCommandTtlMinutes: config.pendingCommandTtlMinutes,
		monicaServiceClient: monicaIntegrationServiceClient,
	};

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
	const processLogger = createLogger("ai-router:process");

	internal.post("/process", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = InboundEventSchema.safeParse(body);
		if (!parsed.success) {
			processLogger.warn("Inbound event validation failed", {
				issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
			});
			return c.json({ error: "Invalid event payload" }, 400);
		}

		const event = parsed.data;

		const startMs = performance.now();

		const result = await runAgentLoop(agentDeps, event.userId, event, event.correlationId);

		const durationMs = Math.round(performance.now() - startMs);

		// Record duration as a span attribute on the active span
		const activeSpan = trace.getActiveSpan();
		if (activeSpan) {
			activeSpan.setAttribute("agent.total_duration_ms", durationMs);
		}

		processLogger.info("Agent loop complete", {
			correlationId: event.correlationId,
			userId: event.userId,
			eventType: event.type,
			durationMs,
			responseType: result.type,
		});

		return c.json(result);
	});

	// 3. Clear history endpoint (caller: telegram-bridge only)
	const clearHistorySchema = z.object({ userId: z.string().uuid() });

	internal.use(
		"/clear-history",
		serviceAuth({
			audience: "ai-router",
			secrets: config.auth.jwtSecrets,
			allowedCallers: ["telegram-bridge"],
		}),
	);

	internal.post("/clear-history", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = clearHistorySchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const count = await clearHistory(db, parsed.data.userId);

		processLogger.info("Conversation history cleared", {
			userId: parsed.data.userId,
			deletedRows: count,
		});

		return c.json({ cleared: true, deletedRows: count });
	});

	app.route("/internal", internal);

	// 4. Contact resolution routes (own per-endpoint auth, no LLM guardrails needed)
	app.route("/internal", contactResolutionRoutes(config));

	// 5. Retention cleanup routes (own per-endpoint auth, caller: scheduler only)
	app.route("/internal", retentionRoutes(config, db));

	// 6. User data purge routes (own per-endpoint auth, caller: user-management only)
	app.route("/internal", userPurgeRoutes(config, db));

	return app;
}
