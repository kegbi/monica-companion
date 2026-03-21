import { describe, expect, it } from "vitest";
import {
	ConversationStateSchema,
	GraphResponseSchema,
	PendingCommandRefSchema,
	TurnSummarySchema,
} from "../state.js";

describe("TurnSummarySchema", () => {
	it("accepts valid turn summary", () => {
		const result = TurnSummarySchema.safeParse({
			role: "user",
			summary: "Asked about Jane's birthday",
			createdAt: "2026-01-01T00:00:00Z",
			correlationId: "corr-123",
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid role", () => {
		const result = TurnSummarySchema.safeParse({
			role: "unknown",
			summary: "test",
			createdAt: "2026-01-01T00:00:00Z",
			correlationId: "corr-123",
		});
		expect(result.success).toBe(false);
	});

	it("accepts all valid roles", () => {
		for (const role of ["user", "assistant", "system"]) {
			const result = TurnSummarySchema.safeParse({
				role,
				summary: "test",
				createdAt: "2026-01-01T00:00:00Z",
				correlationId: "corr-123",
			});
			expect(result.success).toBe(true);
		}
	});
});

describe("PendingCommandRefSchema", () => {
	it("accepts valid pending command ref", () => {
		const result = PendingCommandRefSchema.safeParse({
			pendingCommandId: "550e8400-e29b-41d4-a716-446655440000",
			version: 1,
			status: "draft",
			commandType: "create_contact",
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing required fields", () => {
		const result = PendingCommandRefSchema.safeParse({
			pendingCommandId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.success).toBe(false);
	});
});

describe("GraphResponseSchema", () => {
	it("accepts text response", () => {
		const result = GraphResponseSchema.safeParse({
			type: "text",
			text: "I received your message.",
		});
		expect(result.success).toBe(true);
	});

	it("accepts confirmation prompt with pendingCommandId and version", () => {
		const result = GraphResponseSchema.safeParse({
			type: "confirmation_prompt",
			text: "Create contact Jane?",
			pendingCommandId: "cmd-123",
			version: 1,
		});
		expect(result.success).toBe(true);
	});

	it("accepts disambiguation prompt with options", () => {
		const result = GraphResponseSchema.safeParse({
			type: "disambiguation_prompt",
			text: "Which Jane?",
			options: [
				{ label: "Jane Doe", value: "jane-doe-id" },
				{ label: "Jane Smith", value: "jane-smith-id" },
			],
		});
		expect(result.success).toBe(true);
	});

	it("accepts error response", () => {
		const result = GraphResponseSchema.safeParse({
			type: "error",
			text: "Something went wrong.",
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid type", () => {
		const result = GraphResponseSchema.safeParse({
			type: "invalid_type",
			text: "test",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing text", () => {
		const result = GraphResponseSchema.safeParse({
			type: "text",
		});
		expect(result.success).toBe(false);
	});
});

describe("ConversationStateSchema", () => {
	const validInboundEvent = {
		type: "text_message" as const,
		userId: "550e8400-e29b-41d4-a716-446655440000",
		sourceRef: "telegram:msg:123",
		correlationId: "corr-456",
		text: "Hello",
	};

	it("accepts minimal valid state", () => {
		const result = ConversationStateSchema.safeParse({
			userId: "550e8400-e29b-41d4-a716-446655440000",
			correlationId: "corr-456",
			inboundEvent: validInboundEvent,
		});
		expect(result.success).toBe(true);
	});

	it("applies defaults for optional array and nullable fields", () => {
		const result = ConversationStateSchema.safeParse({
			userId: "550e8400-e29b-41d4-a716-446655440000",
			correlationId: "corr-456",
			inboundEvent: validInboundEvent,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.recentTurns).toEqual([]);
			expect(result.data.activePendingCommand).toBeNull();
			expect(result.data.response).toBeNull();
			expect(result.data.intentClassification).toBeNull();
		}
	});

	it("accepts valid intentClassification in state", () => {
		const result = ConversationStateSchema.safeParse({
			userId: "550e8400-e29b-41d4-a716-446655440000",
			correlationId: "corr-456",
			inboundEvent: validInboundEvent,
			intentClassification: {
				intent: "mutating_command",
				detectedLanguage: "en",
				userFacingText: "Creating a note for Jane.",
				commandType: "create_note",
				contactRef: "Jane",
				commandPayload: { body: "lunch" },
				confidence: 0.95,
			},
		});
		expect(result.success).toBe(true);
	});

	it("defaults intentClassification to null", () => {
		const result = ConversationStateSchema.safeParse({
			userId: "550e8400-e29b-41d4-a716-446655440000",
			correlationId: "corr-456",
			inboundEvent: validInboundEvent,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.intentClassification).toBeNull();
		}
	});

	it("rejects missing required fields", () => {
		const result = ConversationStateSchema.safeParse({
			userId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.success).toBe(false);
	});

	it("accepts valid contactResolution with resolved outcome", () => {
		const result = ConversationStateSchema.safeParse({
			userId: "550e8400-e29b-41d4-a716-446655440000",
			correlationId: "corr-456",
			inboundEvent: validInboundEvent,
			contactResolution: {
				outcome: "resolved",
				resolved: {
					contactId: 42,
					displayName: "Jane Doe",
					aliases: ["Jane"],
					relationshipLabels: ["friend"],
					importantDates: [],
					lastInteractionAt: null,
				},
				candidates: [],
				query: "Jane",
			},
		});
		expect(result.success).toBe(true);
	});

	it("defaults contactResolution to null", () => {
		const result = ConversationStateSchema.safeParse({
			userId: "550e8400-e29b-41d4-a716-446655440000",
			correlationId: "corr-456",
			inboundEvent: validInboundEvent,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.contactResolution).toBeNull();
		}
	});

	it("defaults contactSummariesCache to null", () => {
		const result = ConversationStateSchema.safeParse({
			userId: "550e8400-e29b-41d4-a716-446655440000",
			correlationId: "corr-456",
			inboundEvent: validInboundEvent,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.contactSummariesCache).toBeNull();
		}
	});

	it("does not accept the old resolvedContact field", () => {
		const result = ConversationStateSchema.safeParse({
			userId: "550e8400-e29b-41d4-a716-446655440000",
			correlationId: "corr-456",
			inboundEvent: validInboundEvent,
			resolvedContact: { id: 42, name: "Jane" },
		});
		// If the schema still has resolvedContact, this field will be accepted.
		// After the migration, we expect it to be stripped (strict) or ignored.
		// The key assertion is that the parsed data does NOT contain resolvedContact.
		if (result.success) {
			expect("resolvedContact" in result.data).toBe(false);
		}
	});
});
