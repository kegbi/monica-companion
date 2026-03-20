/**
 * Clarification turn benchmark fixtures.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. No real user data, API keys,
 * credentials, or PII is used. Names, dates, and relationships are
 * fabricated for testing purposes only.
 *
 * All cases are status: "active" now that the LangGraph intent
 * classification pipeline supports evaluation.
 *
 * 25 cases covering subcategories:
 * - Disambiguation questions (cl-001 to cl-005)
 * - Disambiguation answers (cl-006 to cl-010)
 * - Confirmations (cl-011 to cl-015)
 * - Negations (cl-016 to cl-019)
 * - Edits / corrections (cl-020 to cl-022)
 * - Provide missing info (cl-023 to cl-025)
 *
 * Includes 5+ voice-style utterances and 3+ multi-language.
 */
import type { ContactResolutionSummary, IntentBenchmarkCase } from "@monica-companion/types";

const sampleContacts: ContactResolutionSummary[] = [
	{
		contactId: 1,
		displayName: "Sherry Miller",
		aliases: ["Sherry", "Miller"],
		relationshipLabels: ["friend"],
		importantDates: [],
		lastInteractionAt: null,
	},
	{
		contactId: 2,
		displayName: "Sherry Chen",
		aliases: ["Sherry", "Chen"],
		relationshipLabels: ["colleague"],
		importantDates: [],
		lastInteractionAt: "2026-03-10T14:30:00Z",
	},
	{
		contactId: 3,
		displayName: "Alex Torres",
		aliases: ["Alex", "Torres"],
		relationshipLabels: ["friend"],
		importantDates: [],
		lastInteractionAt: "2026-03-01T12:00:00Z",
	},
	{
		contactId: 4,
		displayName: "Alex Kim",
		aliases: ["Alex", "Kim"],
		relationshipLabels: ["colleague"],
		importantDates: [],
		lastInteractionAt: "2026-02-15T09:00:00Z",
	},
	{
		contactId: 5,
		displayName: "David Park",
		aliases: ["David", "Park"],
		relationshipLabels: ["spouse"],
		importantDates: [],
		lastInteractionAt: "2026-03-18T20:00:00Z",
	},
	{
		contactId: 6,
		displayName: "David Chen",
		aliases: ["David", "Chen"],
		relationshipLabels: ["colleague"],
		importantDates: [],
		lastInteractionAt: "2026-03-10T14:30:00Z",
	},
];

export const clarificationCases: IntentBenchmarkCase[] = [
	// ========================================================================
	// Disambiguation questions (cl-001 to cl-005)
	// ========================================================================
	{
		id: "cl-001",
		category: "clarification",
		status: "active",
		description: "Disambiguation question - which Sherry",
		input: {
			utterance: "Which Sherry?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-002",
		category: "clarification",
		status: "active",
		description: "Disambiguation question - which Alex",
		input: {
			utterance: "Which Alex do you mean?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-003",
		category: "clarification",
		status: "active",
		description: "Voice-style disambiguation - which David",
		input: {
			utterance: "wait which david are you talking about",
			voiceSamplePath: "voice/clarification/cl-003.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-004",
		category: "clarification",
		status: "active",
		description: "Disambiguation question in Spanish",
		input: {
			utterance: "A cual Sherry te refieres?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-005",
		category: "clarification",
		status: "active",
		description: "Disambiguation question - asking for options",
		input: {
			utterance: "I have two Alexes, which one?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	// ========================================================================
	// Disambiguation answers (cl-006 to cl-010)
	// ========================================================================
	{
		id: "cl-006",
		category: "clarification",
		status: "active",
		description: "Disambiguation answer - the one from work",
		input: {
			utterance: "The one from work",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: "The one from work",
			resolvedContactId: 2,
			isMutating: false,
		},
	},
	{
		id: "cl-007",
		category: "clarification",
		status: "active",
		description: "Disambiguation answer - the friend",
		input: {
			utterance: "The friend one, not the colleague",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: "The friend one",
			resolvedContactId: 1,
			isMutating: false,
		},
	},
	{
		id: "cl-008",
		category: "clarification",
		status: "active",
		description: "Voice-style disambiguation answer with full name",
		input: {
			utterance: "i mean alex torres not alex kim",
			voiceSamplePath: "voice/clarification/cl-008.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: "alex torres",
			resolvedContactId: 3,
			isMutating: false,
		},
	},
	{
		id: "cl-009",
		category: "clarification",
		status: "active",
		description: "Disambiguation answer with last name",
		input: {
			utterance: "Chen, David Chen",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: "David Chen",
			resolvedContactId: 6,
			isMutating: false,
		},
	},
	{
		id: "cl-010",
		category: "clarification",
		status: "active",
		description: "Disambiguation answer - my husband",
		input: {
			utterance: "My husband David",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: "husband David",
			resolvedContactId: 5,
			isMutating: false,
		},
	},
	// ========================================================================
	// Confirmations (cl-011 to cl-015)
	// ========================================================================
	{
		id: "cl-011",
		category: "clarification",
		status: "active",
		description: "Simple confirmation - yes",
		input: {
			utterance: "Yes, that's right",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-012",
		category: "clarification",
		status: "active",
		description: "Voice-style confirmation",
		input: {
			utterance: "yeah thats the one go ahead",
			voiceSamplePath: "voice/clarification/cl-012.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-013",
		category: "clarification",
		status: "active",
		description: "Confirmation - correct",
		input: {
			utterance: "Correct, please proceed",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-014",
		category: "clarification",
		status: "active",
		description: "Confirmation in French",
		input: {
			utterance: "Oui, c'est ca",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-015",
		category: "clarification",
		status: "active",
		description: "Confirmation with emphasis",
		input: {
			utterance: "Absolutely, that is exactly what I meant",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	// ========================================================================
	// Negations (cl-016 to cl-019)
	// ========================================================================
	{
		id: "cl-016",
		category: "clarification",
		status: "active",
		description: "Simple negation",
		input: {
			utterance: "No, not that one",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-017",
		category: "clarification",
		status: "active",
		description: "Voice-style negation with correction",
		input: {
			utterance: "no no no the other one not that alex",
			voiceSamplePath: "voice/clarification/cl-017.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-018",
		category: "clarification",
		status: "active",
		description: "Negation with cancellation",
		input: {
			utterance: "Never mind, cancel that",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-019",
		category: "clarification",
		status: "active",
		description: "Negation in German",
		input: {
			utterance: "Nein, das ist falsch",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	// ========================================================================
	// Edits / corrections (cl-020 to cl-022)
	// ========================================================================
	{
		id: "cl-020",
		category: "clarification",
		status: "active",
		description: "Edit - change the name",
		input: {
			utterance: "Actually, I meant David Park not David Chen",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: "David Park",
			resolvedContactId: 5,
			isMutating: false,
		},
	},
	{
		id: "cl-021",
		category: "clarification",
		status: "active",
		description: "Voice-style edit with correction",
		input: {
			utterance: "wait i said the wrong person i meant sherry chen not sherry miller",
			voiceSamplePath: "voice/clarification/cl-021.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: "sherry chen",
			resolvedContactId: 2,
			isMutating: false,
		},
	},
	{
		id: "cl-022",
		category: "clarification",
		status: "active",
		description: "Edit with partial correction",
		input: {
			utterance: "Change that to Alex Kim instead",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: "Alex Kim",
			resolvedContactId: 4,
			isMutating: false,
		},
	},
	// ========================================================================
	// Provide missing info (cl-023 to cl-025)
	// ========================================================================
	{
		id: "cl-023",
		category: "clarification",
		status: "active",
		description: "Provide missing date info",
		input: {
			utterance: "The date is March 15th",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-024",
		category: "clarification",
		status: "active",
		description: "Voice-style provide missing phone number",
		input: {
			utterance: "oh the number is five five five zero one four two",
			voiceSamplePath: "voice/clarification/cl-024.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "cl-025",
		category: "clarification",
		status: "active",
		description: "Provide missing email in Portuguese",
		input: {
			utterance: "O email e carlos@exemplo.com.br",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
];
