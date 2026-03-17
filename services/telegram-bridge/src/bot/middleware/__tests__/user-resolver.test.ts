import { describe, expect, it, vi } from "vitest";
import { createUserResolver } from "../user-resolver";

function createMockCtx(telegramUserId: number | undefined) {
	return {
		from: telegramUserId !== undefined ? { id: telegramUserId } : undefined,
		reply: vi.fn(async () => ({})),
		userId: undefined as string | undefined,
		correlationId: undefined as string | undefined,
		telegramUserId: undefined as number | undefined,
	};
}

describe("userResolver middleware", () => {
	it("attaches userId and correlationId for onboarded user", async () => {
		const mockLookup = vi.fn(async () => ({
			found: true as const,
			userId: "user-uuid-123",
		}));
		const middleware = createUserResolver(mockLookup);
		const ctx = createMockCtx(12345);
		const next = vi.fn(async () => {});

		await middleware(ctx as never, next);

		expect(ctx.userId).toBe("user-uuid-123");
		expect(ctx.correlationId).toBeDefined();
		expect(typeof ctx.correlationId).toBe("string");
		expect(ctx.telegramUserId).toBe(12345);
		expect(next).toHaveBeenCalled();
		expect(mockLookup).toHaveBeenCalledWith("12345");
	});

	it("sends setup prompt for non-onboarded user", async () => {
		const mockLookup = vi.fn(async () => ({
			found: false as const,
		}));
		const middleware = createUserResolver(mockLookup);
		const ctx = createMockCtx(67890);
		const next = vi.fn(async () => {});

		await middleware(ctx as never, next);

		expect(ctx.reply).toHaveBeenCalled();
		expect(next).not.toHaveBeenCalled();
	});

	it("does not call next when from is undefined", async () => {
		const mockLookup = vi.fn(async () => ({ found: false as const }));
		const middleware = createUserResolver(mockLookup);
		const ctx = createMockCtx(undefined);
		const next = vi.fn(async () => {});

		await middleware(ctx as never, next);

		expect(next).not.toHaveBeenCalled();
		expect(mockLookup).not.toHaveBeenCalled();
	});
});
