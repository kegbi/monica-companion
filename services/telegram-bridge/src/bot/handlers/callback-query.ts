import type { InboundEvent } from "@monica-companion/types";
import { decodeCallbackData } from "../callback-data";
import type { BotContext } from "../context";

export type ForwardEventFn = (event: InboundEvent) => Promise<void>;

/**
 * Creates a handler for callback queries (inline keyboard button presses).
 * Answers the callback query locally, then forwards as a connector-neutral event.
 */
export function createCallbackQueryHandler(forwardEvent: ForwardEventFn) {
	return async (ctx: BotContext): Promise<void> => {
		// Always answer the callback query locally -- never crosses service boundary
		await ctx.answerCallbackQuery();

		try {
			const data = ctx.callbackQuery?.data;
			if (!data) return;

			const decoded = decodeCallbackData(data);
			if (!decoded) {
				return;
			}

			await ctx.api.sendChatAction(ctx.chat!.id, "typing");

			const event: InboundEvent = {
				type: "callback_action",
				userId: ctx.userId,
				sourceRef: `tg:cb:${ctx.callbackQuery!.message!.message_id}`,
				action: decoded.action,
				data: `${decoded.pendingCommandId}:${decoded.version}`,
				correlationId: ctx.correlationId,
			};

			await forwardEvent(event);
		} catch {
			await ctx.reply("Sorry, I encountered an error processing your selection. Please try again.");
		}
	};
}
