import { describe, expect, it } from "vitest";
import { InboundEventSchema } from "../inbound-event.js";

describe("InboundEventSchema", () => {
	describe("text_message", () => {
		it("parses a valid text_message event", () => {
			const result = InboundEventSchema.safeParse({
				type: "text_message",
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "tg:msg:12345",
				text: "Hello, world!",
				correlationId: "corr-abc-123",
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.type).toBe("text_message");
				expect(result.data.userId).toBe("550e8400-e29b-41d4-a716-446655440000");
				expect(result.data.sourceRef).toBe("tg:msg:12345");
				expect(result.data.correlationId).toBe("corr-abc-123");
				if (result.data.type === "text_message") {
					expect(result.data.text).toBe("Hello, world!");
				}
			}
		});

		it("rejects text_message with missing text", () => {
			const result = InboundEventSchema.safeParse({
				type: "text_message",
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "tg:msg:12345",
				correlationId: "corr-abc-123",
			});
			expect(result.success).toBe(false);
		});

		it("rejects text_message with non-UUID userId", () => {
			const result = InboundEventSchema.safeParse({
				type: "text_message",
				userId: "not-a-uuid",
				sourceRef: "tg:msg:12345",
				text: "hello",
				correlationId: "corr-abc-123",
			});
			expect(result.success).toBe(false);
		});
	});

	describe("voice_message", () => {
		it("parses a valid voice_message event", () => {
			const result = InboundEventSchema.safeParse({
				type: "voice_message",
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "tg:voice:67890",
				transcribedText: "This is transcribed text.",
				correlationId: "corr-def-456",
			});
			expect(result.success).toBe(true);
			if (result.success && result.data.type === "voice_message") {
				expect(result.data.transcribedText).toBe("This is transcribed text.");
			}
		});

		it("rejects voice_message with missing transcribedText", () => {
			const result = InboundEventSchema.safeParse({
				type: "voice_message",
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "tg:voice:67890",
				correlationId: "corr-def-456",
			});
			expect(result.success).toBe(false);
		});
	});

	describe("callback_action", () => {
		it("parses a valid callback_action event", () => {
			const result = InboundEventSchema.safeParse({
				type: "callback_action",
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "tg:cb:11111",
				action: "confirm",
				data: "cmd-id-123:1",
				correlationId: "corr-ghi-789",
			});
			expect(result.success).toBe(true);
			if (result.success && result.data.type === "callback_action") {
				expect(result.data.action).toBe("confirm");
				expect(result.data.data).toBe("cmd-id-123:1");
			}
		});

		it("rejects callback_action with missing action", () => {
			const result = InboundEventSchema.safeParse({
				type: "callback_action",
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "tg:cb:11111",
				data: "cmd-id-123:1",
				correlationId: "corr-ghi-789",
			});
			expect(result.success).toBe(false);
		});
	});

	it("rejects unknown event type", () => {
		const result = InboundEventSchema.safeParse({
			type: "unknown_type",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			sourceRef: "test",
			correlationId: "corr-123",
		});
		expect(result.success).toBe(false);
	});

	it("has no Telegram-specific fields in schema", () => {
		const valid = InboundEventSchema.safeParse({
			type: "text_message",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			sourceRef: "tg:msg:12345",
			text: "hello",
			correlationId: "corr-abc",
			telegramUserId: 12345,
			chatId: 12345,
		});
		// Extra fields should be stripped (not cause validation to fail)
		expect(valid.success).toBe(true);
		if (valid.success) {
			// biome-ignore lint/suspicious/noExplicitAny: checking for absence of Telegram fields
			expect((valid.data as any).telegramUserId).toBeUndefined();
			// biome-ignore lint/suspicious/noExplicitAny: checking for absence of Telegram fields
			expect((valid.data as any).chatId).toBeUndefined();
		}
	});
});
