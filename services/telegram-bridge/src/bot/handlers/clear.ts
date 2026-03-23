import { createLogger } from "@monica-companion/observability";
import type { BotContext } from "../context";

const logger = createLogger("telegram-bridge:clear-handler");

export type ClearHistoryFn = (userId: string) => Promise<{ cleared: boolean }>;

/**
 * Creates a handler for the /clear command.
 * Clears the user's conversation history in ai-router.
 */
export function createClearHandler(clearHistory: ClearHistoryFn) {
	return async (ctx: BotContext): Promise<void> => {
		// Guard: check for registered user
		if (!ctx.userId) {
			await ctx.reply("You are not connected. Use /start to set up your account.");
			return;
		}

		try {
			await clearHistory(ctx.userId);
			await ctx.reply("Conversation history cleared. You can start fresh!");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error("Failed to clear history", {
				correlationId: ctx.correlationId,
				userId: ctx.userId,
				error: msg,
			});
			await ctx.reply(
				"Sorry, I encountered an error clearing your history. Please try again later.",
			);
		}
	};
}
