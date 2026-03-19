import { describe, expect, it } from "vitest";
import type { IntentClassificationResult } from "../../intent-schemas.js";
import { type ActionOutcome, GraphResponseSchema, type PendingCommandRef } from "../../state.js";
import { formatResponseNode } from "../format-response.js";

function makeState(
	intentClassification: IntentClassificationResult | null,
	overrides: Record<string, unknown> = {},
) {
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
		actionOutcome: null,
		...overrides,
	};
}

describe("formatResponseNode", () => {
	// --- Existing behavior (no action outcome) ---

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

	// --- Clarification and disambiguation responses ---

	it("produces text response for needsClarification without options", () => {
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Which contact did you mean?",
			commandType: "create_note",
			contactRef: null,
			commandPayload: null,
			confidence: 0.5,
			needsClarification: true,
			clarificationReason: "missing_fields",
		};

		const update = formatResponseNode(makeState(classification));
		expect(update.response).toEqual({
			type: "text",
			text: "Which contact did you mean?",
		});
	});

	it("produces disambiguation_prompt for needsClarification with options", () => {
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Which Jane did you mean?",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: null,
			confidence: 0.6,
			needsClarification: true,
			clarificationReason: "ambiguous_contact",
			disambiguationOptions: [
				{ label: "Jane Doe", value: "jane-doe-id" },
				{ label: "Jane Smith", value: "jane-smith-id" },
			],
		};

		const update = formatResponseNode(makeState(classification));
		expect(update.response).toEqual({
			type: "disambiguation_prompt",
			text: "Which Jane did you mean?",
			options: [
				{ label: "Jane Doe", value: "jane-doe-id" },
				{ label: "Jane Smith", value: "jane-smith-id" },
			],
		});
	});

	it("includes pendingCommandId and version from active pending command on disambiguation", () => {
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Which Jane?",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: null,
			confidence: 0.6,
			needsClarification: true,
			clarificationReason: "ambiguous_contact",
			disambiguationOptions: [
				{ label: "Jane Doe", value: "jane-doe-id" },
				{ label: "Jane Smith", value: "jane-smith-id" },
			],
		};

		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-456",
			version: 2,
			status: "draft",
			commandType: "create_note",
		};

		const update = formatResponseNode(makeState(classification, { activePendingCommand }));
		expect(update.response).toEqual({
			type: "disambiguation_prompt",
			text: "Which Jane?",
			options: [
				{ label: "Jane Doe", value: "jane-doe-id" },
				{ label: "Jane Smith", value: "jane-smith-id" },
			],
			pendingCommandId: "cmd-456",
			version: 2,
		});
	});

	it("produces valid GraphResponse for clarification without options", () => {
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "What note would you like to add?",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: null,
			confidence: 0.5,
			needsClarification: true,
			clarificationReason: "missing_fields",
		};

		const update = formatResponseNode(makeState(classification));
		const parsed = GraphResponseSchema.safeParse(update.response);
		expect(parsed.success).toBe(true);
	});

	it("produces valid GraphResponse for disambiguation with options", () => {
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Which Jane?",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: null,
			confidence: 0.6,
			needsClarification: true,
			clarificationReason: "ambiguous_contact",
			disambiguationOptions: [
				{ label: "Jane Doe", value: "jane-doe-id" },
				{ label: "Jane Smith", value: "jane-smith-id" },
			],
		};

		const update = formatResponseNode(makeState(classification));
		const parsed = GraphResponseSchema.safeParse(update.response);
		expect(parsed.success).toBe(true);
	});

	// --- Action outcome-driven responses ---

	it("produces confirmation_prompt for pending_created action outcome", () => {
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll create a note for Jane about lunch. Confirm?",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { body: "lunch" },
			confidence: 0.85,
		};

		const actionOutcome: ActionOutcome = {
			type: "pending_created",
			pendingCommandId: "cmd-123",
			version: 2,
		};

		const update = formatResponseNode(makeState(classification, { actionOutcome }));
		expect(update.response).toEqual({
			type: "confirmation_prompt",
			text: "I'll create a note for Jane about lunch. Confirm?",
			pendingCommandId: "cmd-123",
			version: 2,
		});
	});

	it("produces text response for confirmed action outcome", () => {
		const classification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Done! Note created for Jane.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};

		const actionOutcome: ActionOutcome = {
			type: "confirmed",
			pendingCommandId: "cmd-456",
		};

		const update = formatResponseNode(makeState(classification, { actionOutcome }));
		expect(update.response).toEqual({
			type: "text",
			text: "Done! Note created for Jane.",
		});
	});

	it("produces text response for auto_confirmed action outcome", () => {
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Note created for Jane about lunch.",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { body: "lunch" },
			confidence: 0.97,
		};

		const actionOutcome: ActionOutcome = {
			type: "auto_confirmed",
			pendingCommandId: "cmd-789",
		};

		const update = formatResponseNode(makeState(classification, { actionOutcome }));
		expect(update.response).toEqual({
			type: "text",
			text: "Note created for Jane about lunch.",
		});
	});

	it("produces text response for cancelled action outcome", () => {
		const classification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Command cancelled.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};

		const actionOutcome: ActionOutcome = { type: "cancelled" };

		const update = formatResponseNode(makeState(classification, { actionOutcome }));
		expect(update.response).toEqual({
			type: "text",
			text: "Command cancelled.",
		});
	});

	it("produces error response for stale_rejected action outcome", () => {
		const classification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Confirming.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};

		const actionOutcome: ActionOutcome = {
			type: "stale_rejected",
			reason: "This command has already expired. Please start a new request.",
		};

		const update = formatResponseNode(makeState(classification, { actionOutcome }));
		expect(update.response).toEqual({
			type: "error",
			text: "This command has already expired. Please start a new request.",
		});
	});

	it("falls through to default for edit_draft action outcome", () => {
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "What would you like to change?",
			commandType: "create_note",
			contactRef: null,
			commandPayload: null,
			confidence: 0.5,
			needsClarification: true,
			clarificationReason: "missing_fields",
		};

		const actionOutcome: ActionOutcome = { type: "edit_draft" };

		const update = formatResponseNode(makeState(classification, { actionOutcome }));
		// edit_draft falls through to the default text response
		expect(update.response).toEqual({
			type: "text",
			text: "What would you like to change?",
		});
	});

	it("falls through to default for passthrough action outcome", () => {
		const classification: IntentClassificationResult = {
			intent: "greeting",
			detectedLanguage: "en",
			userFacingText: "Hello! How can I help?",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.99,
		};

		const actionOutcome: ActionOutcome = { type: "passthrough" };

		const update = formatResponseNode(makeState(classification, { actionOutcome }));
		expect(update.response).toEqual({
			type: "text",
			text: "Hello! How can I help?",
		});
	});

	it("produces valid GraphResponse for confirmation_prompt", () => {
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Confirm?",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { body: "lunch" },
			confidence: 0.85,
		};

		const actionOutcome: ActionOutcome = {
			type: "pending_created",
			pendingCommandId: "cmd-123",
			version: 1,
		};

		const update = formatResponseNode(makeState(classification, { actionOutcome }));
		const parsed = GraphResponseSchema.safeParse(update.response);
		expect(parsed.success).toBe(true);
	});
});
