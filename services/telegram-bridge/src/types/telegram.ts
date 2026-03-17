/**
 * Telegram-specific internal types used only inside telegram-bridge.
 * These types MUST NOT cross service boundaries.
 */

/** Internal context carrying Telegram-specific identifiers for the current update. */
export interface TelegramInboundContext {
	telegramUserId: number;
	chatId: number;
	messageId: number;
	callbackQueryId?: string;
}
