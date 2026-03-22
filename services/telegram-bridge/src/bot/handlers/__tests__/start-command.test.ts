import { describe, expect, it, vi } from "vitest";
import type { UserLookupFn } from "../../middleware/user-resolver.js";
import { createStartHandler, type IssueSetupTokenFn } from "../start-command.js";

function createMockCtx(options: { fromId?: number; skipFrom?: boolean } = {}) {
	const ctx: Record<string, unknown> = {
		reply: vi.fn(async () => ({})),
	};
	if (!options.skipFrom) {
		ctx.from = { id: options.fromId ?? 12345 };
	}
	return ctx;
}

describe("startCommandHandler", () => {
	it("sends setup URL for unregistered user", async () => {
		const mockLookup: UserLookupFn = vi.fn(async () => ({ found: false as const }));
		const mockIssueToken: IssueSetupTokenFn = vi.fn(async () => ({
			setupUrl: "https://app.example.com/setup?sig=abc123",
			tokenId: "token-uuid-1",
			expiresAt: "2026-03-21T12:15:00Z",
		}));

		const handler = createStartHandler(mockLookup, mockIssueToken);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(mockLookup).toHaveBeenCalledWith("12345");
		expect(mockIssueToken).toHaveBeenCalledWith("12345", expect.any(String));
		expect(ctx.reply).toHaveBeenCalledTimes(1);
		const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		const replyOpts = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
			string,
			unknown
		>;
		expect(replyText).toContain("https://app.example.com/setup?sig=abc123");
		expect(replyText).toContain("<a href=");
		expect(replyOpts.parse_mode).toBe("HTML");
	});

	it("sends already-set-up message for registered user", async () => {
		const mockLookup: UserLookupFn = vi.fn(async () => ({
			found: true as const,
			userId: "user-uuid-123",
		}));
		const mockIssueToken: IssueSetupTokenFn = vi.fn();

		const handler = createStartHandler(mockLookup, mockIssueToken);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(mockLookup).toHaveBeenCalledWith("12345");
		expect(mockIssueToken).not.toHaveBeenCalled();
		expect(ctx.reply).toHaveBeenCalledTimes(1);
		const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(replyText).toContain("already set up");
	});

	it("sends fallback error message when issueSetupToken throws", async () => {
		const mockLookup: UserLookupFn = vi.fn(async () => ({ found: false as const }));
		const mockIssueToken: IssueSetupTokenFn = vi.fn(async () => {
			throw new Error("Service unavailable");
		});

		const handler = createStartHandler(mockLookup, mockIssueToken);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(ctx.reply).toHaveBeenCalledTimes(1);
		const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(replyText).toContain("error");
		expect(replyText).toContain("try again");
	});

	it("sends fallback error message when lookupUser throws", async () => {
		const mockLookup: UserLookupFn = vi.fn(async () => {
			throw new Error("Connection refused");
		});
		const mockIssueToken: IssueSetupTokenFn = vi.fn();

		const handler = createStartHandler(mockLookup, mockIssueToken);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(mockIssueToken).not.toHaveBeenCalled();
		expect(ctx.reply).toHaveBeenCalledTimes(1);
		const replyText = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(replyText).toContain("error");
		expect(replyText).toContain("try again");
	});

	it("returns early without action when ctx.from is undefined", async () => {
		const mockLookup: UserLookupFn = vi.fn();
		const mockIssueToken: IssueSetupTokenFn = vi.fn();

		const handler = createStartHandler(mockLookup, mockIssueToken);
		const ctx = createMockCtx({ skipFrom: true });

		await handler(ctx as never);

		expect(mockLookup).not.toHaveBeenCalled();
		expect(mockIssueToken).not.toHaveBeenCalled();
		expect(ctx.reply).not.toHaveBeenCalled();
	});
});
