import { describe, expect, it, vi } from "vitest";
import { createTextMessageHandler } from "../text-message";

function createMockCtx(text: string) {
	return {
		userId: "user-uuid-123",
		correlationId: "corr-abc",
		telegramUserId: 12345,
		message: { message_id: 99, text },
		chat: { id: 12345 },
		api: {
			sendChatAction: vi.fn(async () => true),
		},
		reply: vi.fn(async () => ({})),
	};
}

describe("textMessageHandler", () => {
	it("sends typing indicator and forwards to ai-router", async () => {
		const mockForward = vi.fn(async () => {});
		const handler = createTextMessageHandler(mockForward);
		const ctx = createMockCtx("Hello, what's John's birthday?");

		await handler(ctx as never);

		expect(ctx.api.sendChatAction).toHaveBeenCalledWith(12345, "typing");
		expect(mockForward).toHaveBeenCalledWith({
			type: "text_message",
			userId: "user-uuid-123",
			sourceRef: "tg:msg:99",
			text: "Hello, what's John's birthday?",
			correlationId: "corr-abc",
		});
	});

	it("sends error message when ai-router call fails", async () => {
		const mockForward = vi.fn(async () => {
			throw new Error("Network error");
		});
		const handler = createTextMessageHandler(mockForward);
		const ctx = createMockCtx("test");

		await handler(ctx as never);

		expect(ctx.reply).toHaveBeenCalledWith(
			"Sorry, I encountered an error processing your message. Please try again.",
		);
	});
});
