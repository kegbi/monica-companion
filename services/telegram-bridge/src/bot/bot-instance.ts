import { Bot } from "grammy";

/**
 * Creates a grammY Bot instance configured for webhook mode.
 * No long polling is used; updates are exclusively received via webhook.
 */
export function createBot(token: string): Bot {
	return new Bot(token);
}
