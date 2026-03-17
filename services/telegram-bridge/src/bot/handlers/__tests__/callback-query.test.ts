import { describe, expect, it, vi } from "vitest";
import { createCallbackQueryHandler } from "../callback-query";

function createMockCtx(data: string) {
	return {
		userId: "user-uuid-123",
		correlationId: "corr-cb",
		telegramUserId: 12345,
		callbackQuery: {
			id: "cb-query-id-999",
			data,
			message: { message_id: 77 },
		},
		chat: { id: 12345 },
		api: {
			sendChatAction: vi.fn(async () => true),
		},
		answerCallbackQuery: vi.fn(async () => true),
		reply: vi.fn(async () => ({})),
	};
}

describe("callbackQueryHandler", () => {
	it("answers callback query, sends typing, and forwards to ai-router", async () => {
		const mockForward = vi.fn(async () => {});
		const handler = createCallbackQueryHandler(mockForward);
		const ctx = createMockCtx("confirm:cmd-id-123:1");

		await handler(ctx as never);

		expect(ctx.answerCallbackQuery).toHaveBeenCalled();
		expect(ctx.api.sendChatAction).toHaveBeenCalledWith(12345, "typing");
		expect(mockForward).toHaveBeenCalledWith({
			type: "callback_action",
			userId: "user-uuid-123",
			sourceRef: "tg:cb:77",
			action: "confirm",
			data: "cmd-id-123:1",
			correlationId: "corr-cb",
		});
	});

	it("replies with error for invalid callback data", async () => {
		const mockForward = vi.fn(async () => {});
		const handler = createCallbackQueryHandler(mockForward);
		const ctx = createMockCtx("invalid-data");

		await handler(ctx as never);

		expect(ctx.answerCallbackQuery).toHaveBeenCalled();
		expect(mockForward).not.toHaveBeenCalled();
	});

	it("sends error reply when ai-router call fails", async () => {
		const mockForward = vi.fn(async () => {
			throw new Error("Network error");
		});
		const handler = createCallbackQueryHandler(mockForward);
		const ctx = createMockCtx("confirm:cmd-id:1");

		await handler(ctx as never);

		expect(ctx.reply).toHaveBeenCalledWith(
			"Sorry, I encountered an error processing your selection. Please try again.",
		);
	});
});
