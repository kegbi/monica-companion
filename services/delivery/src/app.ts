import { createServiceClient, serviceAuth } from "@monica-companion/auth";
import { createLogger, otelMiddleware } from "@monica-companion/observability";
import { OutboundMessageIntentSchema } from "@monica-companion/types";
import { trace } from "@opentelemetry/api";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Config } from "./config";
import type { Database } from "./db/connection";
import { deliveryAudits } from "./db/schema";

const logger = createLogger("delivery");
const tracer = trace.getTracer("delivery");

const CONNECTOR_URL_MAP: Record<string, (config: Config) => string> = {
	telegram: (config) => config.telegramBridgeUrl,
};

export interface AppDeps {
	db: Database;
}

export function createApp(config: Config, deps: AppDeps) {
	const app = new Hono();

	app.use(otelMiddleware());

	app.get("/health", (c) => c.json({ status: "ok", service: "delivery" }));

	const internal = new Hono();
	internal.use(
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
			const urlResolver = CONNECTOR_URL_MAP[intent.connectorType];
			if (!urlResolver) {
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

			const connectorBaseUrl = urlResolver(config);
			const connectorClient = createServiceClient({
				issuer: "delivery",
				audience: intent.connectorType === "telegram" ? "telegram-bridge" : "telegram-bridge",
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

	return app;
}
