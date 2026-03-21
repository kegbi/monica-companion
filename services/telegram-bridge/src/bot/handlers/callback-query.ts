import { createLogger } from "@monica-companion/observability";
import type { InboundEvent } from "@monica-companion/types";
import { decodeCallbackData } from "../callback-data";
import type { BotContext } from "../context";

const logger = createLogger("telegram-bridge:callback-handler");

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
				logger.warn("Failed to decode callback data", {
					correlationId: ctx.correlationId,
					userId: ctx.userId,
				});
				return;
			}

			logger.info("Processing callback action", {
				correlationId: ctx.correlationId,
				userId: ctx.userId,
				action: decoded.action,
				pendingCommandId: decoded.pendingCommandId,
				version: decoded.version,
			});

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
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error("Failed to process callback query", {
				correlationId: ctx.correlationId,
				userId: ctx.userId,
				error: msg,
			});
			await ctx.reply("Sorry, I encountered an error processing your selection. Please try again.");
		}
	};
}
