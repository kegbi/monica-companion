import { describe, expect, it, vi } from "vitest";
import { privateChatOnly } from "../private-chat-only";

function createMockCtx(chatType: string | undefined) {
	return {
		chat: chatType ? { type: chatType } : undefined,
	};
}

describe("privateChatOnly middleware", () => {
	it("calls next for private chat", async () => {
		const ctx = createMockCtx("private");
		const next = vi.fn(async () => {});
		await privateChatOnly(ctx as never, next);
		expect(next).toHaveBeenCalled();
	});

	it("silently drops group messages", async () => {
		const ctx = createMockCtx("group");
		const next = vi.fn(async () => {});
		await privateChatOnly(ctx as never, next);
		expect(next).not.toHaveBeenCalled();
	});

	it("silently drops supergroup messages", async () => {
		const ctx = createMockCtx("supergroup");
		const next = vi.fn(async () => {});
		await privateChatOnly(ctx as never, next);
		expect(next).not.toHaveBeenCalled();
	});

	it("silently drops channel messages", async () => {
		const ctx = createMockCtx("channel");
		const next = vi.fn(async () => {});
		await privateChatOnly(ctx as never, next);
		expect(next).not.toHaveBeenCalled();
	});

	it("silently drops updates with no chat", async () => {
		const ctx = createMockCtx(undefined);
		const next = vi.fn(async () => {});
		await privateChatOnly(ctx as never, next);
		expect(next).not.toHaveBeenCalled();
	});
});
