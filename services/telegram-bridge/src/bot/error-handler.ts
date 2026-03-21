import { createLogger } from "@monica-companion/observability";
import type { Context } from "grammy";

const logger = createLogger("telegram-bridge:error-handler");

const FALLBACK_MESSAGE = "Sorry, something went wrong. Please try again later.";

/**
 * Creates a grammY error handler for bot.catch().
 * Logs the error and sends a fallback message to the user.
 */
export function createErrorHandler() {
	return async (error: unknown, ctx: Context): Promise<void> => {
		const msg = error instanceof Error ? error.message : String(error);
		logger.error("Unhandled bot error", { error: msg });

		try {
			if (typeof ctx?.reply === "function") {
				await ctx.reply(FALLBACK_MESSAGE);
			}
		} catch (replyErr) {
			const replyMsg = replyErr instanceof Error ? replyErr.message : String(replyErr);
			logger.error("Failed to send fallback error message", { error: replyMsg });
		}
	};
}
