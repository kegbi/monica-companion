import { serviceAuth } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";
import { AiRouterRetentionCleanupRequestSchema } from "@monica-companion/types";
import { Hono } from "hono";
import type { Config } from "../config.js";
import type { Database } from "../db/connection.js";
import { purgeExpiredConversationTurns, purgeExpiredPendingCommands } from "./cleanup.js";

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

		const conversationTurnsCutoff = new Date(parsed.data.conversationTurnsCutoff);
		const pendingCommandsCutoff = new Date(parsed.data.pendingCommandsCutoff);

		const conversationTurns = await purgeExpiredConversationTurns(db, conversationTurnsCutoff);
		const pendingCommands = await purgeExpiredPendingCommands(db, pendingCommandsCutoff);

		logger.info("Retention cleanup completed", {
			conversationTurnsPurged: conversationTurns,
			pendingCommandsPurged: pendingCommands,
		});

		return c.json({ purged: { conversationTurns, pendingCommands } });
	});

	return routes;
}
