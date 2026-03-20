import { describe, expect, it, vi } from "vitest";
import { createDisconnectHandler, type DisconnectFn } from "../disconnect-command.js";

function createMockCtx(options: { userId?: string; skipUserId?: boolean } = {}) {
	const ctx: Record<string, unknown> = {
		correlationId: "corr-abc",
		telegramUserId: 12345,
		reply: vi.fn(async () => ({})),
	};
	if (!options.skipUserId) {
		ctx.userId = options.userId ?? "user-uuid-123";
	}
	return ctx;
}

describe("disconnectCommandHandler", () => {
	it("calls disconnect and sends success message for registered user", async () => {
		const mockDisconnect: DisconnectFn = vi.fn(async () => ({
			disconnected: true,
			purgeScheduledAt: "2024-03-01T00:00:00Z",
		}));

		const handler = createDisconnectHandler(mockDisconnect);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(mockDisconnect).toHaveBeenCalledWith("user-uuid-123", "corr-abc");
		expect(ctx.reply).toHaveBeenCalledWith(
			"Your account has been disconnected. Your Monica credentials have been deleted immediately. All your data will be purged within 30 days.",
		);
	});

	it("returns early with message for unregistered user (no userId)", async () => {
		const mockDisconnect: DisconnectFn = vi.fn();

		const handler = createDisconnectHandler(mockDisconnect);
		const ctx = createMockCtx({ skipUserId: true });

		await handler(ctx as never);

		expect(mockDisconnect).not.toHaveBeenCalled();
		expect(ctx.reply).toHaveBeenCalledWith(
			"You are not connected. Use /start to set up your account.",
		);
	});

	it("sends error message when disconnect call fails", async () => {
		const mockDisconnect: DisconnectFn = vi.fn(async () => {
			throw new Error("Service unavailable");
		});

		const handler = createDisconnectHandler(mockDisconnect);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(ctx.reply).toHaveBeenCalledWith(
			"Sorry, I encountered an error disconnecting your account. Please try again later.",
		);
	});
});
