import { randomUUID } from "node:crypto";
import type { NextFunction } from "grammy";
import type { BotContext } from "../context";

export type UserLookupFn = (
	connectorUserId: string,
) => Promise<{ found: true; userId: string } | { found: false }>;

/**
 * Creates a grammY middleware that resolves the Telegram user ID to an internal UUID.
 * If the user is not onboarded, sends a setup prompt and stops processing.
 */
export function createUserResolver(lookupUser: UserLookupFn) {
	return async (ctx: BotContext, next: NextFunction): Promise<void> => {
		const telegramUserId = ctx.from?.id;
		if (telegramUserId === undefined) {
			return;
		}

		const result = await lookupUser(String(telegramUserId));

		if (!result.found) {
			await ctx.reply(
				"Welcome! You need to complete setup before using this bot. Please use /start to begin.",
			);
			return;
		}

		ctx.userId = result.userId;
		ctx.correlationId = randomUUID();
		ctx.telegramUserId = telegramUserId;

		await next();
	};
}
