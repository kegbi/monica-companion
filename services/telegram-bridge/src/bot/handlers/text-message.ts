import { createLogger } from "@monica-companion/observability";
import type { InboundEvent } from "@monica-companion/types";
import type { BotContext } from "../context";

const logger = createLogger("telegram-bridge:text-handler");

export type ForwardEventFn = (event: InboundEvent) => Promise<void>;

/**
 * Creates a handler for text messages.
 * Sends typing indicator, builds connector-neutral event, forwards to ai-router.
 */
export function createTextMessageHandler(forwardEvent: ForwardEventFn) {
	return async (ctx: BotContext): Promise<void> => {
		try {
			await ctx.api.sendChatAction(ctx.chat!.id, "typing");

			const event: InboundEvent = {
				type: "text_message",
				userId: ctx.userId,
				sourceRef: `tg:msg:${ctx.message!.message_id}`,
				text: ctx.message!.text!,
				correlationId: ctx.correlationId,
			};

			await forwardEvent(event);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error("Failed to process text message", {
				correlationId: ctx.correlationId,
				userId: ctx.userId,
				error: msg,
			});
			await ctx.reply("Sorry, I encountered an error processing your message. Please try again.");
		}
	};
}
