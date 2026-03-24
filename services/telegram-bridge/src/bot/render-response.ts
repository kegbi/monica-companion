import type { AiRouterResponse } from "../lib/ai-router-client.js";
import { encodeCallbackData } from "./callback-data.js";
import type { BotContext } from "./context.js";

/**
 * Renders an AiRouterResponse back to the user via grammY context.
 * Handles text, confirmation prompts, disambiguation prompts, and errors.
 */
export async function renderResponse(ctx: BotContext, response: AiRouterResponse): Promise<void> {
	switch (response.type) {
		case "text": {
			await ctx.reply(response.text, { parse_mode: "Markdown" });
			break;
		}
		case "confirmation_prompt": {
			const cmdId = response.pendingCommandId ?? "";
			const ver = response.version ?? 1;
			const keyboard = {
				inline_keyboard: [
					[
						{
							text: "Yes",
							callback_data: encodeCallbackData("confirm", cmdId, ver),
						},
						{
							text: "Edit",
							callback_data: encodeCallbackData("edit", cmdId, ver),
						},
						{
							text: "Cancel",
							callback_data: encodeCallbackData("cancel", cmdId, ver),
						},
					],
				],
			};
			await ctx.reply(response.text, { reply_markup: keyboard });
			break;
		}
		case "disambiguation_prompt": {
			const options = response.options ?? [];
			const keyboard = {
				inline_keyboard: options.map((opt) => [
					{
						text: opt.label,
						callback_data: encodeCallbackData("select", opt.value, 0),
					},
				]),
			};
			await ctx.reply(response.text, { reply_markup: keyboard });
			break;
		}
		case "error": {
			await ctx.reply(response.text);
			break;
		}
	}
}
