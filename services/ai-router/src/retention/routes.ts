import { serviceAuth } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";
import { AiRouterRetentionCleanupRequestSchema } from "@monica-companion/types";
import { Hono } from "hono";
import type { Config } from "../config.js";
import type { Database } from "../db/connection.js";
import { purgeExpiredConversationHistory } from "./cleanup.js";

const logger = createLogger("ai-router");

/**
 * Retention cleanup routes for ai-router.
 * Separate Hono sub-app with per-endpoint auth: only scheduler may call.
 */
export function retentionRoutes(config: Config, db: Database) {
	const routes = new Hono();

	routes.use(
		"/retention-cleanup",
		serviceAuth({
			audience: "ai-router",
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

		const parsed = AiRouterRetentionCleanupRequestSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const conversationHistoryCutoff = new Date(parsed.data.conversationHistoryCutoff);

		const conversationHistory = await purgeExpiredConversationHistory(
			db,
			conversationHistoryCutoff,
		);

		logger.info("Retention cleanup completed", {
			conversationHistoryPurged: conversationHistory,
		});

		return c.json({ purged: { conversationHistory } });
	});

	return routes;
}
