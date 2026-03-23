import { describe, expect, it, vi } from "vitest";
import { type ClearHistoryFn, createClearHandler } from "../clear.js";

function createMockCtx(options: { userId?: string; skipUserId?: boolean } = {}) {
	const ctx: Record<string, unknown> = {
		correlationId: "corr-clear-1",
		telegramUserId: 12345,
		reply: vi.fn(async () => ({})),
	};
	if (!options.skipUserId) {
		ctx.userId = options.userId ?? "user-uuid-123";
	}
	return ctx;
}

describe("clearCommandHandler", () => {
	it("calls clearHistory and sends success message for registered user", async () => {
		const mockClear: ClearHistoryFn = vi.fn(async () => ({
			cleared: true,
		}));

		const handler = createClearHandler(mockClear);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(mockClear).toHaveBeenCalledWith("user-uuid-123");
		expect(ctx.reply).toHaveBeenCalledWith("Conversation history cleared. You can start fresh!");
	});

	it("returns early with message for unregistered user (no userId)", async () => {
		const mockClear: ClearHistoryFn = vi.fn();

		const handler = createClearHandler(mockClear);
		const ctx = createMockCtx({ skipUserId: true });

		await handler(ctx as never);

		expect(mockClear).not.toHaveBeenCalled();
		expect(ctx.reply).toHaveBeenCalledWith(
			"You are not connected. Use /start to set up your account.",
		);
	});

	it("sends error message when clearHistory call fails", async () => {
		const mockClear: ClearHistoryFn = vi.fn(async () => {
			throw new Error("Service unavailable");
		});

		const handler = createClearHandler(mockClear);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(ctx.reply).toHaveBeenCalledWith(
			"Sorry, I encountered an error clearing your history. Please try again later.",
		);
	});
});
