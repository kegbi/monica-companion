import { randomUUID } from "node:crypto";
import { createLogger } from "@monica-companion/observability";
import type { BotContext } from "../context";
import type { UserLookupFn } from "../middleware/user-resolver";

const logger = createLogger("telegram-bridge:start-handler");

export type IssueSetupTokenFn = (
	telegramUserId: string,
	correlationId?: string,
) => Promise<{ setupUrl: string; tokenId: string; expiresAt: string }>;

/**
 * Creates a handler for the /start command.
 * Detects whether the user is registered and either sends a setup link
 * (for new users) or an "already set up" message (for existing users).
 *
 * This handler runs before the userResolver middleware so it can serve
 * unregistered users who have not yet completed onboarding.
 */
export function createStartHandler(lookupUser: UserLookupFn, issueSetupToken: IssueSetupTokenFn) {
	return async (ctx: BotContext): Promise<void> => {
		const telegramUserId = ctx.from?.id;
		if (telegramUserId === undefined) {
			return;
		}

		const correlationId = randomUUID();

		try {
			const result = await lookupUser(String(telegramUserId));

			if (result.found) {
				await ctx.reply(
					"You're already set up! Send me a message or voice note to get started. Use /disconnect to unlink your account.",
				);
				return;
			}

			const { setupUrl } = await issueSetupToken(String(telegramUserId), correlationId);

			await ctx.reply(
				`Welcome to Monica Companion! To get started, please complete your setup using this link:\n\n<a href="${setupUrl}">Open Setup</a>\n\nYour credentials will be collected securely through the web form — never share them in this chat. The link expires in 15 minutes.`,
				{ parse_mode: "HTML" },
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error("Failed to handle /start command", {
				correlationId,
				telegramUserId: String(telegramUserId),
				error: msg,
			});
			await ctx.reply("Sorry, I encountered an error. Please try again later.");
		}
	};
}
