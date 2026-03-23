import { serviceAuth } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";
import { Hono } from "hono";
import { z } from "zod/v4";
import type { Config } from "../config.js";
import type { Database } from "../db/connection.js";
import {
	purgeUserConversationHistory,
	purgeUserConversationTurns,
	purgeUserPendingCommands,
} from "./user-purge.js";

const logger = createLogger("ai-router");
const uuidSchema = z.string().uuid();

/**
 * User data purge routes for ai-router.
 * Separate Hono sub-app with per-endpoint auth: only user-management may call.
 */
export function userPurgeRoutes(config: Config, db: Database) {
	const routes = new Hono();

	routes.use(
		serviceAuth({
			audience: "ai-router",
			secrets: config.auth.jwtSecrets,
			allowedCallers: ["user-management"],
		}),
	);

	routes.delete("/users/:userId/data", async (c) => {
		const userId = c.req.param("userId");

		const uuidResult = uuidSchema.safeParse(userId);
		if (!uuidResult.success) {
			return c.json({ error: "Invalid userId format" }, 400);
		}

		const conversationTurns = await purgeUserConversationTurns(db, userId);
		const pendingCommands = await purgeUserPendingCommands(db, userId);
		const conversationHistory = await purgeUserConversationHistory(db, userId);

		logger.info("User data purge completed", {
			userId,
			conversationTurnsPurged: conversationTurns,
			pendingCommandsPurged: pendingCommands,
			conversationHistoryPurged: conversationHistory,
		});

		return c.json({ purged: { conversationTurns, pendingCommands, conversationHistory } });
	});

	return routes;
}
