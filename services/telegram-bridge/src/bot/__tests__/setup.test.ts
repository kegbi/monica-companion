import { describe, expect, it, vi } from "vitest";
import { setupBot } from "../setup";

describe("setupBot", () => {
	it("registers middleware and handlers in correct order", () => {
		const use = vi.fn();
		const on = vi.fn();
		const command = vi.fn();
		const catchFn = vi.fn();

		const mockBot = {
			use,
			on,
			command,
			catch: catchFn,
		};

		const deps = {
			lookupUser: vi.fn(async () => ({ found: true as const, userId: "uuid" })),
			forwardEvent: vi.fn(async () => {}),
			downloadFile: vi.fn(async () => ({ buffer: new ArrayBuffer(0) })),
			transcribe: vi.fn(async () => ({
				success: true,
				text: "test",
				correlationId: "corr",
			})),
			disconnect: vi.fn(async () => ({
				disconnected: true,
				purgeScheduledAt: "2024-01-01T00:00:00Z",
			})),
		};

		setupBot(mockBot as never, deps);

		// Should register 2 middleware: privateChatOnly and userResolver
		expect(use).toHaveBeenCalledTimes(2);

		// Should register 1 command: disconnect (before message handlers)
		expect(command).toHaveBeenCalledTimes(1);
		expect(command.mock.calls[0][0]).toBe("disconnect");

		// Should register 3 handlers: text message, voice message, callback query
		expect(on).toHaveBeenCalledTimes(3);

		// on("message:text", ...) should be called
		expect(on.mock.calls[0][0]).toBe("message:text");
		// on("message:voice", ...) should be called
		expect(on.mock.calls[1][0]).toBe("message:voice");
		// on("callback_query:data", ...) should be called
		expect(on.mock.calls[2][0]).toBe("callback_query:data");

		// Should register error handler
		expect(catchFn).toHaveBeenCalledTimes(1);
	});
});
