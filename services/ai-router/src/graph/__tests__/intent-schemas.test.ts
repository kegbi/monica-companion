import { describe, expect, it } from "vitest";
import {
	type IntentClassificationResult,
	IntentClassificationResultSchema,
} from "../intent-schemas.js";

describe("IntentClassificationResultSchema", () => {
	it("accepts a valid mutating_command result", () => {
		const input = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll create a note for Jane.",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { body: "Met for coffee" },
			confidence: 0.95,
		};
		const result = IntentClassificationResultSchema.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("accepts a valid read_query result", () => {
		const input = {
			intent: "read_query",
			detectedLanguage: "fr",
			userFacingText: "Voici l'anniversaire de Jane.",
			commandType: "query_birthday",
			contactRef: "Jane Doe",
			commandPayload: {},
			confidence: 0.88,
		};
		const result = IntentClassificationResultSchema.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("accepts a greeting with null commandType, contactRef, commandPayload", () => {
		const input = {
			intent: "greeting",
			detectedLanguage: "en",
			userFacingText: "Hello! How can I help you?",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.99,
		};
		const result = IntentClassificationResultSchema.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("accepts an out_of_scope result", () => {
		const input = {
			intent: "out_of_scope",
			detectedLanguage: "en",
			userFacingText: "I can only help with personal CRM tasks.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.92,
		};
		const result = IntentClassificationResultSchema.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("accepts a clarification_response result", () => {
		const input = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Got it, you meant Jane Doe.",
			commandType: "create_note",
			contactRef: "Jane Doe",
			commandPayload: { body: "Meeting notes" },
			confidence: 0.85,
		};
		const result = IntentClassificationResultSchema.safeParse(input);
		expect(result.success).toBe(true);
	});

	it("rejects invalid intent value", () => {
		const input = {
			intent: "invalid_intent",
			detectedLanguage: "en",
			userFacingText: "test",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.5,
		};
		const result = IntentClassificationResultSchema.safeParse(input);
		expect(result.success).toBe(false);
	});

	it("rejects invalid commandType value", () => {
		const input = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "test",
			commandType: "delete_everything",
			contactRef: null,
			commandPayload: null,
			confidence: 0.5,
		};
		const result = IntentClassificationResultSchema.safeParse(input);
		expect(result.success).toBe(false);
	});

	it("rejects confidence below 0", () => {
		const input = {
			intent: "greeting",
			detectedLanguage: "en",
			userFacingText: "Hi!",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: -0.1,
		};
		const result = IntentClassificationResultSchema.safeParse(input);
		expect(result.success).toBe(false);
	});

	it("rejects confidence above 1", () => {
		const input = {
			intent: "greeting",
			detectedLanguage: "en",
			userFacingText: "Hi!",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 1.5,
		};
		const result = IntentClassificationResultSchema.safeParse(input);
		expect(result.success).toBe(false);
	});

	it("rejects missing required fields", () => {
		const result = IntentClassificationResultSchema.safeParse({
			intent: "greeting",
		});
		expect(result.success).toBe(false);
	});

	it("accepts needsClarification with clarificationReason and disambiguationOptions", () => {
		const input = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Which Jane did you mean?",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { body: "lunch" },
			confidence: 0.7,
			needsClarification: true,
			clarificationReason: "ambiguous_contact",
			disambiguationOptions: [
				{ label: "Jane Doe", value: "jane-doe-id" },
				{ label: "Jane Smith", value: "jane-smith-id" },
			],
		};
		const result = IntentClassificationResultSchema.safeParse(input);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.needsClarification).toBe(true);
			expect(result.data.clarificationReason).toBe("ambiguous_contact");
			expect(result.data.disambiguationOptions).toHaveLength(2);
		}
	});

	it("defaults needsClarification to false when not provided", () => {
		const input = {
			intent: "greeting",
			detectedLanguage: "en",
			userFacingText: "Hello!",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.99,
		};
		const result = IntentClassificationResultSchema.safeParse(input);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.needsClarification).toBe(false);
		}
	});

	it("accepts all valid clarificationReason values", () => {
		for (const reason of ["ambiguous_contact", "missing_fields", "unclear_intent"]) {
			const input = {
				intent: "mutating_command",
				detectedLanguage: "en",
				userFacingText: "Need clarification",
				commandType: "create_note",
				contactRef: null,
				commandPayload: null,
				confidence: 0.5,
				needsClarification: true,
				clarificationReason: reason,
			};
			const result = IntentClassificationResultSchema.safeParse(input);
			expect(result.success, `clarificationReason "${reason}" should be accepted`).toBe(true);
		}
	});

	it("rejects invalid clarificationReason value", () => {
		const input = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "test",
			commandType: "create_note",
			contactRef: null,
			commandPayload: null,
			confidence: 0.5,
			needsClarification: true,
			clarificationReason: "invalid_reason",
		};
		const result = IntentClassificationResultSchema.safeParse(input);
		expect(result.success).toBe(false);
	});

	it("uses z.enum for commandType covering all V1 command types", () => {
		// Verify all V1 command types are accepted
		const v1CommandTypes = [
			"create_contact",
			"create_note",
			"create_activity",
			"update_contact_birthday",
			"update_contact_phone",
			"update_contact_email",
			"update_contact_address",
			"query_birthday",
			"query_phone",
			"query_last_note",
		];
		for (const ct of v1CommandTypes) {
			const input = {
				intent: "mutating_command",
				detectedLanguage: "en",
				userFacingText: "test",
				commandType: ct,
				contactRef: "Test",
				commandPayload: {},
				confidence: 0.9,
			};
			const result = IntentClassificationResultSchema.safeParse(input);
			expect(result.success, `commandType "${ct}" should be accepted`).toBe(true);
		}
	});
});
