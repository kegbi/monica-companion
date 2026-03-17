import type { Context } from "grammy";

const FALLBACK_MESSAGE = "Sorry, something went wrong. Please try again later.";

/**
 * Creates a grammY error handler for bot.catch().
 * Sends a fallback message to the user and handles the case where reply itself fails.
 */
export function createErrorHandler() {
	return async (error: unknown, ctx: Context): Promise<void> => {
		try {
			if (typeof ctx?.reply === "function") {
				await ctx.reply(FALLBACK_MESSAGE);
			}
		} catch {
			// If we can't even send the fallback message, silently swallow.
			// The error is already logged by the bot framework.
		}
	};
}
