import type { Bot } from "grammy";
import type { Context as HonoContext } from "hono";
import type { UpdateDedup } from "./update-dedup";

/**
 * Creates a Hono route handler that feeds Telegram updates to the grammY bot.
 * Always returns HTTP 200 to Telegram, even if processing fails.
 */
export function createWebhookHandler(bot: Bot, dedup: UpdateDedup) {
	return async (c: HonoContext) => {
		try {
			const update = await c.req.json();
			const updateId = update?.update_id;

			if (typeof updateId === "number") {
				const isDuplicate = await dedup.isDuplicate(updateId);
				if (isDuplicate) {
					return c.json({ ok: true });
				}
			}

			await bot.handleUpdate(update);
		} catch {
			// Always return 200 to prevent Telegram from retrying
		}

		return c.json({ ok: true });
	};
}
