import type { Context, NextFunction } from "grammy";

/**
 * grammY middleware that enforces private-chat-only policy.
 * Silently drops all updates that are not from private chats.
 */
export async function privateChatOnly(ctx: Context, next: NextFunction): Promise<void> {
	if (ctx.chat?.type === "private") {
		await next();
	}
	// Silently drop group, supergroup, channel, and chatless updates
}
