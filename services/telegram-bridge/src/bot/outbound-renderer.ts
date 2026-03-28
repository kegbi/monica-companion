import type { OutboundMessageIntent } from "@monica-companion/types";
import type { Api } from "grammy";
import { encodeCallbackData } from "./callback-data";
import { sanitizeTelegramMarkdown } from "./sanitize-markdown";

/**
 * Renders a connector-neutral outbound message intent as a Telegram message.
 * Dispatches based on content type.
 */
export async function renderOutbound(api: Api, intent: OutboundMessageIntent): Promise<void> {
	const chatId = Number(intent.connectorRoutingId);
	const { content } = intent;

	switch (content.type) {
		case "text": {
			const sanitized = sanitizeTelegramMarkdown(content.text);
			try {
				await api.sendMessage(chatId, sanitized, { parse_mode: "Markdown" });
			} catch {
				await api.sendMessage(chatId, content.text);
			}
			break;
		}
		case "confirmation_prompt": {
			const keyboard = {
				inline_keyboard: [
					[
						{
							text: "Yes",
							callback_data: encodeCallbackData(
								"confirm",
								content.pendingCommandId,
								content.version,
							),
						},
						{
							text: "Edit",
							callback_data: encodeCallbackData("edit", content.pendingCommandId, content.version),
						},
						{
							text: "Cancel",
							callback_data: encodeCallbackData(
								"cancel",
								content.pendingCommandId,
								content.version,
							),
						},
					],
				],
			};
			await api.sendMessage(chatId, content.text, { reply_markup: keyboard });
			break;
		}
		case "disambiguation_prompt": {
			const keyboard = {
				inline_keyboard: content.options.map((opt) => [
					{
						text: opt.label,
						callback_data: encodeCallbackData("select", opt.value, 0),
					},
				]),
			};
			await api.sendMessage(chatId, content.text, { reply_markup: keyboard });
			break;
		}
		case "error": {
			await api.sendMessage(chatId, content.text, {});
			break;
		}
	}
}
