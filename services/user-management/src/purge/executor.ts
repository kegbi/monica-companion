import type { ServiceClient } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Config } from "../config";
import type { Database } from "../db/connection";
import { dataPurgeRequests } from "../db/schema";

const logger = createLogger("user-management");

export interface PurgeExecutorDeps {
	config: Config;
	db: Database;
	aiRouterClient: ServiceClient;
	schedulerClient: ServiceClient;
	deliveryClient: ServiceClient;
}

/**
 * Processes pending data purge requests.
 *
 * 1. Reclaims stale in-progress requests using claimed_at.
 * 2. Resets failed requests for retry (below max retries).
 * 3. Atomically claims pending requests whose purge_after has passed.
 * 4. For each claimed request, calls DELETE /internal/users/:userId/data on downstream services.
 * 5. Marks as completed or failed.
 */
export async function processPendingPurges(deps: PurgeExecutorDeps): Promise<void> {
	const { config, db, aiRouterClient, schedulerClient, deliveryClient } = deps;

	// 1. Reclaim stale in-progress requests (using claimed_at for detection)
	const staleThreshold = new Date(Date.now() - config.staleClaimThresholdMinutes * 60 * 1000);
	await db
		.update(dataPurgeRequests)
		.set({ status: "pending" })
		.where(
			and(
				eq(dataPurgeRequests.status, "in_progress"),
				lt(dataPurgeRequests.claimedAt, staleThreshold),
			),
		);

	// 2. Reset failed requests for retry (below max retries)
	await db
		.update(dataPurgeRequests)
		.set({ status: "pending", error: null })
		.where(
			and(
				eq(dataPurgeRequests.status, "failed"),
				lt(dataPurgeRequests.retryCount, config.maxPurgeRetries),
			),
		);

	// 3. Atomically claim pending requests
	const claimed = await db
		.update(dataPurgeRequests)
		.set({ status: "in_progress", claimedAt: new Date() })
		.where(
			and(eq(dataPurgeRequests.status, "pending"), lt(dataPurgeRequests.purgeAfter, new Date())),
		)
		.returning();

	if (claimed.length === 0) {
		return;
	}

	logger.info("Claimed purge requests", { count: claimed.length });

	// 4. Process each claimed request
	for (const request of claimed) {
		try {
			const signal = AbortSignal.timeout(config.httpTimeoutMs);

			await Promise.all([
				aiRouterClient.fetch(`/internal/users/${request.userId}/data`, {
					method: "DELETE",
					signal,
				}),
				schedulerClient.fetch(`/internal/users/${request.userId}/data`, {
					method: "DELETE",
					signal,
				}),
				deliveryClient.fetch(`/internal/users/${request.userId}/data`, {
					method: "DELETE",
					signal,
				}),
			]);

			// 5. Mark as completed
			await db
				.update(dataPurgeRequests)
				.set({ status: "completed", completedAt: new Date() })
				.where(eq(dataPurgeRequests.id, request.id));

			logger.info("Purge request completed", { requestId: request.id });
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);

			// 6. Mark as failed
			await db
				.update(dataPurgeRequests)
				.set({
					status: "failed",
					error: errorMessage,
					retryCount: sql`${dataPurgeRequests.retryCount} + 1`,
				})
				.where(eq(dataPurgeRequests.id, request.id));

			logger.error("Purge request failed", {
				requestId: request.id,
				error: errorMessage,
			});
		}
	}
}
