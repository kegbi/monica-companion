import { describe, expect, it, vi } from "vitest";
import { createErrorHandler } from "../error-handler";

describe("createErrorHandler", () => {
	it("sends fallback message to user on error", async () => {
		const handler = createErrorHandler();
		const ctx = {
			reply: vi.fn(async () => ({})),
			chat: { id: 12345 },
		};
		const error = new Error("Something broke");

		await handler(error, ctx as never);

		expect(ctx.reply).toHaveBeenCalledWith("Sorry, something went wrong. Please try again later.");
	});

	it("handles gracefully when reply also fails", async () => {
		const handler = createErrorHandler();
		const ctx = {
			reply: vi.fn(async () => {
				throw new Error("Reply failed too");
			}),
			chat: { id: 12345 },
		};
		const error = new Error("Something broke");

		// Should not throw
		await expect(handler(error, ctx as never)).resolves.not.toThrow();
	});

	it("handles undefined ctx gracefully", async () => {
		const handler = createErrorHandler();
		const ctx = {
			reply: undefined,
			chat: undefined,
		};
		const error = new Error("Something broke");

		// Should not throw
		await expect(handler(error, ctx as never)).resolves.not.toThrow();
	});
});
