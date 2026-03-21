import type { Bot } from "grammy";
import type { BotContext } from "./context";
import { createErrorHandler } from "./error-handler";
import { createCallbackQueryHandler } from "./handlers/callback-query";
import { createDisconnectHandler, type DisconnectFn } from "./handlers/disconnect-command";
import { createStartHandler, type IssueSetupTokenFn } from "./handlers/start-command";
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
	disconnect: DisconnectFn;
	issueSetupToken: IssueSetupTokenFn;
}

/**
 * Wires all middleware and handlers onto the bot in the correct order:
 * 1. Private-chat-only middleware
 * 2. /start command (before user resolver so unregistered users can onboard)
 * 3. User resolver middleware (blocks unregistered users from other handlers)
 * 4. /disconnect command
 * 5. Text message handler
 * 6. Voice message handler
 * 7. Callback query handler
 * 8. Error handler (bot.catch)
 */
export function setupBot(bot: Bot<BotContext>, deps: SetupDeps): void {
	// Middleware (order matters)
	bot.use(privateChatOnly);

	// /start must be registered BEFORE userResolver so unregistered users can onboard
	bot.command("start", createStartHandler(deps.lookupUser, deps.issueSetupToken));

	bot.use(createUserResolver(deps.lookupUser));

	// Commands (must be registered before generic message handlers)
	bot.command("disconnect", createDisconnectHandler(deps.disconnect));

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
