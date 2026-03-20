import { serviceAuth } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";
import { DeliveryRetentionCleanupRequestSchema } from "@monica-companion/types";
import { Hono } from "hono";
import type { Config } from "../config";
import type { Database } from "../db/connection";
import { purgeExpiredDeliveryAudits } from "./cleanup";

const logger = createLogger("delivery");

/**
 * Retention cleanup routes for delivery.
 * Separate Hono sub-app with per-endpoint auth: only scheduler may call.
 */
export function retentionRoutes(config: Config, db: Database) {
	const routes = new Hono();

	routes.use(
		"/retention-cleanup",
		serviceAuth({
			audience: "delivery",
			secrets: config.auth.jwtSecrets,
			allowedCallers: ["scheduler"],
		}),
	);

	routes.post("/retention-cleanup", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = DeliveryRetentionCleanupRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const deliveryAuditsCutoff = new Date(parsed.data.deliveryAuditsCutoff);
		const deliveryAudits = await purgeExpiredDeliveryAudits(db, deliveryAuditsCutoff);

		logger.info("Retention cleanup completed", {
			deliveryAuditsPurged: deliveryAudits,
		});

		return c.json({ purged: { deliveryAudits } });
	});

	return routes;
}
