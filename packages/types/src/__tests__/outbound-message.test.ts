import { describe, expect, it } from "vitest";
import { OutboundMessageIntentSchema } from "../outbound-message.js";

describe("OutboundMessageIntentSchema", () => {
	describe("text content", () => {
		it("parses a valid text intent", () => {
			const result = OutboundMessageIntentSchema.safeParse({
				userId: "550e8400-e29b-41d4-a716-446655440000",
				connectorType: "telegram",
				connectorRoutingId: "chat-12345",
				correlationId: "corr-abc",
				content: {
					type: "text",
					text: "Hello!",
				},
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.connectorType).toBe("telegram");
				expect(result.data.content.type).toBe("text");
			}
		});
	});

	describe("confirmation_prompt content", () => {
		it("parses a valid confirmation_prompt intent", () => {
			const result = OutboundMessageIntentSchema.safeParse({
				userId: "550e8400-e29b-41d4-a716-446655440000",
				connectorType: "telegram",
				connectorRoutingId: "chat-12345",
				correlationId: "corr-abc",
				content: {
					type: "confirmation_prompt",
					text: "Are you sure?",
					pendingCommandId: "cmd-uuid",
					version: 1,
				},
			});
			expect(result.success).toBe(true);
			if (result.success && result.data.content.type === "confirmation_prompt") {
				expect(result.data.content.pendingCommandId).toBe("cmd-uuid");
				expect(result.data.content.version).toBe(1);
			}
		});
	});

	describe("disambiguation_prompt content", () => {
		it("parses a valid disambiguation_prompt intent", () => {
			const result = OutboundMessageIntentSchema.safeParse({
				userId: "550e8400-e29b-41d4-a716-446655440000",
				connectorType: "telegram",
				connectorRoutingId: "chat-12345",
				correlationId: "corr-abc",
				content: {
					type: "disambiguation_prompt",
					text: "Which one?",
					options: [
						{ label: "Option A", value: "a" },
						{ label: "Option B", value: "b" },
					],
				},
			});
			expect(result.success).toBe(true);
			if (result.success && result.data.content.type === "disambiguation_prompt") {
				expect(result.data.content.options).toHaveLength(2);
			}
		});
	});

	describe("error content", () => {
		it("parses a valid error intent", () => {
			const result = OutboundMessageIntentSchema.safeParse({
				userId: "550e8400-e29b-41d4-a716-446655440000",
				connectorType: "telegram",
				connectorRoutingId: "chat-12345",
				correlationId: "corr-abc",
				content: {
					type: "error",
					text: "Something went wrong",
				},
			});
			expect(result.success).toBe(true);
		});
	});

	it("accepts any non-empty connector type string (connector-neutral)", () => {
		for (const connectorType of ["telegram", "whatsapp", "signal", "matrix"]) {
			const result = OutboundMessageIntentSchema.safeParse({
				userId: "550e8400-e29b-41d4-a716-446655440000",
				connectorType,
				connectorRoutingId: "chat-12345",
				correlationId: "corr-abc",
				content: { type: "text", text: "hello" },
			});
			expect(result.success).toBe(true);
		}
	});

	it("rejects empty connector type string", () => {
		const result = OutboundMessageIntentSchema.safeParse({
			userId: "550e8400-e29b-41d4-a716-446655440000",
			connectorType: "",
			connectorRoutingId: "chat-12345",
			correlationId: "corr-abc",
			content: { type: "text", text: "hello" },
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing content", () => {
		const result = OutboundMessageIntentSchema.safeParse({
			userId: "550e8400-e29b-41d4-a716-446655440000",
			connectorType: "telegram",
			connectorRoutingId: "chat-12345",
			correlationId: "corr-abc",
		});
		expect(result.success).toBe(false);
	});
});
