import type { Context } from "grammy";

/** Custom context flavor for telegram-bridge bot. */
export interface BotContextFlavor {
	/** Internal user UUID resolved from user-management. */
	userId: string;
	/** Correlation ID for this update. */
	correlationId: string;
	/** Telegram user ID (numeric). */
	telegramUserId: number;
}

export type BotContext = Context & BotContextFlavor;
