import { describe, expect, it, vi } from "vitest";
import type { AiRouterResponse } from "../../../lib/ai-router-client.js";
import { createTextMessageHandler } from "../text-message.js";

const TEXT_RESPONSE: AiRouterResponse = { type: "text", text: "John's birthday is March 5." };

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
	it("sends typing indicator, forwards to ai-router, and replies with response", async () => {
		const mockForward = vi.fn(async () => TEXT_RESPONSE);
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
		expect(ctx.reply).toHaveBeenCalledWith("John's birthday is March 5.", {
			parse_mode: "Markdown",
		});
	});

	it("renders error responses from ai-router", async () => {
		const errorResponse: AiRouterResponse = {
			type: "error",
			text: "Sorry, I encountered an error processing your request. Please try again.",
		};
		const mockForward = vi.fn(async () => errorResponse);
		const handler = createTextMessageHandler(mockForward);
		const ctx = createMockCtx("test");

		await handler(ctx as never);

		expect(ctx.reply).toHaveBeenCalledWith(errorResponse.text);
	});

	it("renders confirmation prompts with inline keyboard", async () => {
		const confirmResponse: AiRouterResponse = {
			type: "confirmation_prompt",
			text: "Please confirm: Add note for John",
			pendingCommandId: "cmd-123",
			version: 1,
		};
		const mockForward = vi.fn(async () => confirmResponse);
		const handler = createTextMessageHandler(mockForward);
		const ctx = createMockCtx("add a note for John");

		await handler(ctx as never);

		expect(ctx.reply).toHaveBeenCalledWith(
			"Please confirm: Add note for John",
			expect.objectContaining({
				reply_markup: expect.objectContaining({
					inline_keyboard: expect.arrayContaining([
						expect.arrayContaining([
							expect.objectContaining({ text: "Yes" }),
							expect.objectContaining({ text: "Edit" }),
							expect.objectContaining({ text: "Cancel" }),
						]),
					]),
				}),
			}),
		);
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
