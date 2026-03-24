import type { ServiceClient } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";
import type { Config } from "../config";
import type { Database } from "../db/connection";

const logger = createLogger("scheduler");

function daysAgo(days: number): Date {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export interface RetentionCleanupDeps {
	config: Config;
	db: Database;
	aiRouterClient: ServiceClient;
	deliveryClient: ServiceClient;
	purgeExpiredExecutions: (db: Database, cutoff: Date) => Promise<number>;
	purgeExpiredIdempotencyKeys: (db: Database, cutoff: Date) => Promise<number>;
	purgeExpiredReminderWindows: (db: Database, cutoff: Date) => Promise<number>;
}

/**
 * Processes a retention cleanup cycle:
 * 1. Runs local scheduler cleanup functions.
 * 2. Calls ai-router and delivery cleanup endpoints.
 * 3. Logs the results.
 */
export async function processRetentionCleanup(deps: RetentionCleanupDeps): Promise<void> {
	const {
		config,
		db,
		aiRouterClient,
		deliveryClient,
		purgeExpiredExecutions,
		purgeExpiredIdempotencyKeys,
		purgeExpiredReminderWindows,
	} = deps;

	// Compute cutoff dates
	const conversationHistoryCutoff = daysAgo(config.conversationRetentionDays);
	const executionCutoff = daysAgo(config.commandLogRetentionDays);
	const deliveryAuditCutoff = daysAgo(config.commandLogRetentionDays);
	const idempotencyKeyCutoff = daysAgo(config.idempotencyKeyRetentionDays);
	const reminderWindowCutoff = daysAgo(config.reminderWindowRetentionDays);

	// 1. Local scheduler cleanup
	const executionsPurged = await purgeExpiredExecutions(db, executionCutoff);
	const idempotencyKeysPurged = await purgeExpiredIdempotencyKeys(db, idempotencyKeyCutoff);
	const reminderWindowsPurged = await purgeExpiredReminderWindows(db, reminderWindowCutoff);

	// 2. Call ai-router cleanup
	const aiRouterResponse = await aiRouterClient.fetch("/internal/retention-cleanup", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			conversationHistoryCutoff: conversationHistoryCutoff.toISOString(),
		}),
		signal: AbortSignal.timeout(config.httpTimeoutMs),
	});

	const aiRouterResult = aiRouterResponse.ok
		? ((await aiRouterResponse.json()) as { purged: Record<string, number> })
		: { purged: {} };

	// 3. Call delivery cleanup
	const deliveryResponse = await deliveryClient.fetch("/internal/retention-cleanup", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			deliveryAuditsCutoff: deliveryAuditCutoff.toISOString(),
		}),
		signal: AbortSignal.timeout(config.httpTimeoutMs),
	});

	const deliveryResult = deliveryResponse.ok
		? ((await deliveryResponse.json()) as { purged: Record<string, number> })
		: { purged: {} };

	logger.info("Retention cleanup completed", {
		scheduler: {
			executionsPurged,
			idempotencyKeysPurged,
			reminderWindowsPurged,
		},
		aiRouter: aiRouterResult.purged,
		delivery: deliveryResult.purged,
	});
}
