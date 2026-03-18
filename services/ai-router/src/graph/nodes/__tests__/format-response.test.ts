import { describe, expect, it } from "vitest";
import type { IntentClassificationResult } from "../../intent-schemas.js";
import { GraphResponseSchema } from "../../state.js";
import { formatResponseNode } from "../format-response.js";

function makeState(intentClassification: IntentClassificationResult | null) {
	return {
		userId: "550e8400-e29b-41d4-a716-446655440000",
		correlationId: "corr-123",
		inboundEvent: {
			type: "text_message" as const,
			userId: "550e8400-e29b-41d4-a716-446655440000",
			sourceRef: "telegram:msg:456",
			correlationId: "corr-123",
			text: "Hello",
		},
		recentTurns: [],
		activePendingCommand: null,
		resolvedContact: null,
		userPreferences: null,
		response: null,
		intentClassification,
	};
}

describe("formatResponseNode", () => {
	it("maps mutating_command intent to text response with userFacingText", () => {
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll create a note for Jane.",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { body: "lunch" },
			confidence: 0.95,
		};

		const update = formatResponseNode(makeState(classification));
		expect(update.response).toEqual({
			type: "text",
			text: "I'll create a note for Jane.",
		});
	});

	it("maps read_query intent to text response", () => {
		const classification: IntentClassificationResult = {
			intent: "read_query",
			detectedLanguage: "en",
			userFacingText: "Jane's birthday is March 15th.",
			commandType: "query_birthday",
			contactRef: "Jane",
			commandPayload: {},
			confidence: 0.88,
		};

		const update = formatResponseNode(makeState(classification));
		expect(update.response).toEqual({
			type: "text",
			text: "Jane's birthday is March 15th.",
		});
	});

	it("maps greeting intent to text response", () => {
		const classification: IntentClassificationResult = {
			intent: "greeting",
			detectedLanguage: "en",
			userFacingText: "Hello! How can I help?",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.99,
		};

		const update = formatResponseNode(makeState(classification));
		expect(update.response).toEqual({
			type: "text",
			text: "Hello! How can I help?",
		});
	});

	it("maps out_of_scope intent to text response", () => {
		const classification: IntentClassificationResult = {
			intent: "out_of_scope",
			detectedLanguage: "en",
			userFacingText: "I can only help with CRM tasks.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.92,
		};

		const update = formatResponseNode(makeState(classification));
		expect(update.response).toEqual({
			type: "text",
			text: "I can only help with CRM tasks.",
		});
	});

	it("maps clarification_response intent to text response", () => {
		const classification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Got it, you meant Jane Doe.",
			commandType: "create_note",
			contactRef: "Jane Doe",
			commandPayload: { body: "Meeting" },
			confidence: 0.85,
		};

		const update = formatResponseNode(makeState(classification));
		expect(update.response).toEqual({
			type: "text",
			text: "Got it, you meant Jane Doe.",
		});
	});

	it("returns error response when intentClassification is null", () => {
		const update = formatResponseNode(makeState(null));
		expect(update.response).toEqual({
			type: "error",
			text: "Unable to process your request.",
		});
	});

	it("produces valid GraphResponse in all cases", () => {
		const intents: IntentClassificationResult[] = [
			{
				intent: "mutating_command",
				detectedLanguage: "en",
				userFacingText: "Creating note.",
				commandType: "create_note",
				contactRef: "Jane",
				commandPayload: {},
				confidence: 0.9,
			},
			{
				intent: "greeting",
				detectedLanguage: "fr",
				userFacingText: "Bonjour!",
				commandType: null,
				contactRef: null,
				commandPayload: null,
				confidence: 0.99,
			},
		];

		for (const classification of intents) {
			const update = formatResponseNode(makeState(classification));
			const parsed = GraphResponseSchema.safeParse(update.response);
			expect(
				parsed.success,
				`should produce valid GraphResponse for ${classification.intent}`,
			).toBe(true);
		}
	});
});
