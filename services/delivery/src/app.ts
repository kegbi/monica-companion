import { createServiceClient, serviceAuth } from "@monica-companion/auth";
import { createLogger, otelMiddleware } from "@monica-companion/observability";
import { OutboundMessageIntentSchema } from "@monica-companion/types";
import { trace } from "@opentelemetry/api";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Config } from "./config";
import type { Database } from "./db/connection";
import { deliveryAudits } from "./db/schema";
import { retentionRoutes } from "./retention/routes";
import { userPurgeRoutes } from "./retention/user-purge-routes";

const logger = createLogger("delivery");
const tracer = trace.getTracer("delivery");

export interface AppDeps {
	db: Database;
}

export function createApp(config: Config, deps: AppDeps) {
	const app = new Hono();

	app.use(otelMiddleware());

	app.get("/health", (c) => c.json({ status: "ok", service: "delivery" }));

	const internal = new Hono();
	// Auth scoped to /deliver so it does not collide with other sub-apps mounted at /internal.
	internal.use(
		"/deliver",
		serviceAuth({
			audience: "delivery",
			secrets: config.auth.jwtSecrets,
			allowedCallers: ["ai-router", "scheduler"],
		}),
	);

	internal.post("/deliver", async (c) => {
		return tracer.startActiveSpan("delivery.forward", async (span) => {
			let body: unknown;
			try {
				body = await c.req.json();
			} catch {
				span.end();
				return c.json({ status: "rejected", error: "Invalid request body" }, 400);
			}

			const parsed = OutboundMessageIntentSchema.safeParse(body);
			if (!parsed.success) {
				span.end();
				return c.json({ status: "rejected", error: "Invalid payload" }, 400);
			}

			const intent = parsed.data;

			// Resolve connector URL from config-driven registry
			const connectorBaseUrl = config.connectorRegistry[intent.connectorType];
			if (!connectorBaseUrl) {
				span.end();
				return c.json({ status: "rejected", error: "Unsupported connector type" }, 400);
			}

			// Insert pending audit record
			let auditId: string;
			try {
				const insertResult = await deps.db
					.insert(deliveryAudits)
					.values({
						correlationId: intent.correlationId,
						userId: intent.userId,
						connectorType: intent.connectorType,
						connectorRoutingId: intent.connectorRoutingId,
						contentType: intent.content.type,
						status: "pending",
					})
					.returning({ id: deliveryAudits.id });

				auditId = insertResult[0].id;
			} catch (err) {
				logger.error("Failed to insert delivery audit", {
					correlationId: intent.correlationId,
					error: err instanceof Error ? err.message : String(err),
				});
				span.end();
				return c.json({ error: "Service unavailable: audit persistence failed" }, 503);
			}

			span.setAttribute("delivery.audit_id", auditId);
			span.setAttribute("delivery.correlation_id", intent.correlationId);
			span.setAttribute("delivery.connector_type", intent.connectorType);
			span.setAttribute("delivery.content_type", intent.content.type);

			// Derive audience from connector type using config helper
			const audience = config.connectorAudience(intent.connectorType);

			const connectorClient = createServiceClient({
				issuer: "delivery",
				audience,
				secret: config.auth.jwtSecrets[0],
				baseUrl: connectorBaseUrl,
				fetch: config.fetchFn,
			});

			const startTime = Date.now();

			try {
				await connectorClient.fetch("/internal/send", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(intent),
					correlationId: intent.correlationId,
					userId: intent.userId,
					signal: AbortSignal.timeout(config.httpTimeoutMs),
				});

				const durationMs = Date.now() - startTime;

				// Update audit to delivered
				await deps.db
					.update(deliveryAudits)
					.set({
						status: "delivered",
						completedAt: new Date(),
					})
					.where(eq(deliveryAudits.id, auditId));

				span.setAttribute("delivery.status", "delivered");
				span.setAttribute("delivery.duration_ms", durationMs);
				span.end();

				return c.json({ deliveryId: auditId, status: "delivered" }, 200);
			} catch (err) {
				const durationMs = Date.now() - startTime;
				const errorMessage = err instanceof Error ? err.message : String(err);

				// Update audit to failed
				try {
					await deps.db
						.update(deliveryAudits)
						.set({
							status: "failed",
							error: errorMessage,
							completedAt: new Date(),
						})
						.where(eq(deliveryAudits.id, auditId));
				} catch (dbErr) {
					logger.error("Failed to update delivery audit on failure", {
						auditId,
						correlationId: intent.correlationId,
						error: dbErr instanceof Error ? dbErr.message : String(dbErr),
					});
				}

				span.setAttribute("delivery.status", "failed");
				span.setAttribute("delivery.duration_ms", durationMs);
				span.end();

				logger.error("Delivery failed", {
					auditId,
					correlationId: intent.correlationId,
					connectorType: intent.connectorType,
					error: errorMessage,
				});

				return c.json({ deliveryId: auditId, status: "failed", error: errorMessage }, 502);
			}
		});
	});

	app.route("/internal", internal);

	// Retention cleanup routes (own per-endpoint auth, caller: scheduler only)
	app.route("/internal", retentionRoutes(config, deps.db));

	// User data purge routes (own per-endpoint auth, caller: user-management only)
	app.route("/internal", userPurgeRoutes(config, deps.db));

	return app;
}
