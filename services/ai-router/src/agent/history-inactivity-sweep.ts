import { createLogger } from "@monica-companion/observability";
import type { Database } from "../db/connection.js";
import { clearStaleHistories } from "./history-repository.js";

const logger = createLogger("ai-router:history-inactivity-sweep");

/** Inactivity threshold: 24 hours. */
const INACTIVITY_HOURS = 24;

/**
 * Start a periodic sweep that clears conversation histories inactive
 * for more than 24 hours. Uses the same setInterval pattern as expiry-sweep.
 *
 * Returns a cleanup function that stops the sweep timer.
 */
export function startHistoryInactivitySweep(db: Database, intervalMs: number): () => void {
	const timer = setInterval(async () => {
		try {
			const cutoff = new Date(Date.now() - INACTIVITY_HOURS * 60 * 60 * 1000);
			const count = await clearStaleHistories(db, cutoff);
			if (count > 0) {
				logger.info(`Cleared ${count} inactive conversation history record(s)`);
			}
		} catch (err) {
			logger.error("History inactivity sweep failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}, intervalMs);

	logger.info(`History inactivity sweep started (interval: ${intervalMs}ms)`);

	return () => {
		clearInterval(timer);
		logger.info("History inactivity sweep stopped");
	};
}
