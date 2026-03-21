import { createLogger } from "@monica-companion/observability";
import type { BotContext } from "../context";

const logger = createLogger("telegram-bridge:disconnect-handler");

export type DisconnectFn = (
	userId: string,
	correlationId?: string,
) => Promise<{ disconnected: boolean; purgeScheduledAt: string }>;

/**
 * Creates a handler for the /disconnect command.
 * Checks for registered user, calls user-management disconnect, sends response.
 */
export function createDisconnectHandler(disconnect: DisconnectFn) {
	return async (ctx: BotContext): Promise<void> => {
		// Guard: check for registered user
		if (!ctx.userId) {
			await ctx.reply("You are not connected. Use /start to set up your account.");
			return;
		}

		try {
			await disconnect(ctx.userId, ctx.correlationId);
			await ctx.reply(
				"Your account has been disconnected. Your Monica credentials have been deleted immediately. All your data will be purged within 30 days.",
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error("Failed to disconnect user", {
				correlationId: ctx.correlationId,
				userId: ctx.userId,
				error: msg,
			});
			await ctx.reply(
				"Sorry, I encountered an error disconnecting your account. Please try again later.",
			);
		}
	};
}
