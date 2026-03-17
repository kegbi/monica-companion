import type { Bot } from "grammy";
import type { BotContext } from "./context";
import { createErrorHandler } from "./error-handler";
import { createCallbackQueryHandler } from "./handlers/callback-query";
import { createTextMessageHandler, type ForwardEventFn } from "./handlers/text-message";
import {
	createVoiceMessageHandler,
	type DownloadFileFn,
	type TranscribeFn,
} from "./handlers/voice-message";
import { privateChatOnly } from "./middleware/private-chat-only";
import { createUserResolver, type UserLookupFn } from "./middleware/user-resolver";

export interface SetupDeps {
	lookupUser: UserLookupFn;
	forwardEvent: ForwardEventFn;
	downloadFile: DownloadFileFn;
	transcribe: TranscribeFn;
}

/**
 * Wires all middleware and handlers onto the bot in the correct order:
 * 1. Private-chat-only middleware
 * 2. User resolver middleware
 * 3. Text message handler
 * 4. Voice message handler
 * 5. Callback query handler
 * 6. Error handler (bot.catch)
 */
export function setupBot(bot: Bot<BotContext>, deps: SetupDeps): void {
	// Middleware (order matters)
	bot.use(privateChatOnly);
	bot.use(createUserResolver(deps.lookupUser));

	// Handlers
	bot.on("message:text", createTextMessageHandler(deps.forwardEvent));
	bot.on(
		"message:voice",
		createVoiceMessageHandler(deps.downloadFile, deps.transcribe, deps.forwardEvent),
	);
	bot.on("callback_query:data", createCallbackQueryHandler(deps.forwardEvent));

	// Error handler
	bot.catch(async (err) => {
		const handler = createErrorHandler();
		await handler(err.error, err.ctx);
	});
}
