import { serviceAuth } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";
import { Hono } from "hono";
import { z } from "zod/v4";
import type { Config } from "../config";
import type { Database } from "../db/connection";
import { purgeUserCommandExecutionsAndKeys, purgeUserReminderWindows } from "./user-purge";

const logger = createLogger("scheduler");
const uuidSchema = z.string().uuid();

/**
 * User data purge routes for scheduler.
 * Separate Hono sub-app with per-endpoint auth: only user-management may call.
 */
export function userPurgeRoutes(config: Config, db: Database) {
	const routes = new Hono();

	routes.use(
		serviceAuth({
			audience: "scheduler",
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

		const { commandExecutions, idempotencyKeys } = await purgeUserCommandExecutionsAndKeys(
			db,
			userId,
		);
		const reminderWindows = await purgeUserReminderWindows(db, userId);

		logger.info("User data purge completed", {
			userId,
			commandExecutionsPurged: commandExecutions,
			idempotencyKeysPurged: idempotencyKeys,
			reminderWindowsPurged: reminderWindows,
		});

		return c.json({ purged: { commandExecutions, idempotencyKeys, reminderWindows } });
	});

	return routes;
}
