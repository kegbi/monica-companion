/**
 * Clarification turn benchmark fixtures.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. No real user data, API keys,
 * credentials, or PII is used. Names, dates, and relationships are
 * fabricated for testing purposes only.
 *
 * All cases are status: "active" now that the LangGraph intent
 * classification pipeline supports evaluation.
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
];

export const clarificationCases: IntentBenchmarkCase[] = [
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
		id: "cl-003",
		category: "clarification",
		status: "active",
		description: "Confirmation response",
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
		id: "cl-004",
		category: "clarification",
		status: "active",
		description: "Negation response",
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
];
