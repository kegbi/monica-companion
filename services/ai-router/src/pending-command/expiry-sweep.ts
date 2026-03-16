import { createLogger } from "@monica-companion/observability";
import type { Database } from "../db/connection.js";
import { expireStaleCommands } from "./repository.js";

const logger = createLogger("ai-router:expiry-sweep");

/**
 * Start a periodic sweep that expires stale pending commands.
 * Returns a cleanup function that stops the sweep timer.
 */
export function startExpirySweep(db: Database, intervalMs: number): () => void {
	const timer = setInterval(async () => {
		try {
			const count = await expireStaleCommands(db, new Date());
			if (count > 0) {
				logger.info(`Expired ${count} stale pending command(s)`);
			}
		} catch (err) {
			logger.error("Expiry sweep failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}, intervalMs);

	logger.info(`Expiry sweep started (interval: ${intervalMs}ms)`);

	return () => {
		clearInterval(timer);
		logger.info("Expiry sweep stopped");
	};
}
