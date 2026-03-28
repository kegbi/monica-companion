import type { OutboundMessageIntent } from "@monica-companion/types";
import { describe, expect, it, vi } from "vitest";
import { renderOutbound } from "../outbound-renderer";

function createMockBotApi() {
	return {
		sendMessage: vi.fn(async () => ({})),
	};
}

describe("renderOutbound", () => {
	it("renders text content with Markdown", async () => {
		const api = createMockBotApi();
		const intent: OutboundMessageIntent = {
			userId: "user-uuid",
			connectorType: "telegram",
			connectorRoutingId: "12345",
			correlationId: "corr-abc",
			content: { type: "text", text: "Hello *world*!" },
		};

		await renderOutbound(api as never, intent);

		expect(api.sendMessage).toHaveBeenCalledWith(
			12345,
			"Hello *world*!",
			expect.objectContaining({ parse_mode: "Markdown" }),
		);
	});

	it("renders confirmation_prompt with inline keyboard", async () => {
		const api = createMockBotApi();
		const intent: OutboundMessageIntent = {
			userId: "user-uuid",
			connectorType: "telegram",
			connectorRoutingId: "12345",
			correlationId: "corr-abc",
			content: {
				type: "confirmation_prompt",
				text: "Create contact John?",
				pendingCommandId: "cmd-123",
				version: 1,
			},
		};

		await renderOutbound(api as never, intent);

		expect(api.sendMessage).toHaveBeenCalledWith(
			12345,
			"Create contact John?",
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

	it("renders disambiguation_prompt with option buttons", async () => {
		const api = createMockBotApi();
		const intent: OutboundMessageIntent = {
			userId: "user-uuid",
			connectorType: "telegram",
			connectorRoutingId: "12345",
			correlationId: "corr-abc",
			content: {
				type: "disambiguation_prompt",
				text: "Which John?",
				options: [
					{ label: "John Smith", value: "contact-1" },
					{ label: "John Doe", value: "contact-2" },
				],
			},
		};

		await renderOutbound(api as never, intent);

		expect(api.sendMessage).toHaveBeenCalledWith(
			12345,
			"Which John?",
			expect.objectContaining({
				reply_markup: expect.objectContaining({
					inline_keyboard: expect.arrayContaining([
						expect.arrayContaining([expect.objectContaining({ text: "John Smith" })]),
						expect.arrayContaining([expect.objectContaining({ text: "John Doe" })]),
					]),
				}),
			}),
		);
	});

	it("sanitizes unpaired Markdown markers before sending", async () => {
		const api = createMockBotApi();
		const intent: OutboundMessageIntent = {
			userId: "user-uuid",
			connectorType: "telegram",
			connectorRoutingId: "12345",
			correlationId: "corr-abc",
			content: { type: "text", text: "Contact *Hottabych created" },
		};

		await renderOutbound(api as never, intent);

		expect(api.sendMessage).toHaveBeenCalledWith(
			12345,
			"Contact Hottabych created",
			expect.objectContaining({ parse_mode: "Markdown" }),
		);
	});

	it("falls back to plain text when Markdown send fails", async () => {
		const api = createMockBotApi();
		api.sendMessage
			.mockRejectedValueOnce(new Error("Bad Request: can't parse entities"))
			.mockResolvedValueOnce({});

		const intent: OutboundMessageIntent = {
			userId: "user-uuid",
			connectorType: "telegram",
			connectorRoutingId: "12345",
			correlationId: "corr-abc",
			content: { type: "text", text: "Some [broken markdown" },
		};

		await renderOutbound(api as never, intent);

		expect(api.sendMessage).toHaveBeenCalledTimes(2);
		expect(api.sendMessage).toHaveBeenLastCalledWith(12345, "Some [broken markdown");
	});

	it("renders error content as plain text", async () => {
		const api = createMockBotApi();
		const intent: OutboundMessageIntent = {
			userId: "user-uuid",
			connectorType: "telegram",
			connectorRoutingId: "12345",
			correlationId: "corr-abc",
			content: { type: "error", text: "Something went wrong" },
		};

		await renderOutbound(api as never, intent);

		expect(api.sendMessage).toHaveBeenCalledWith(12345, "Something went wrong", {});
	});
});
