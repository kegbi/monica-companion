/**
 * Read intent benchmark fixtures.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. No real user data, API keys,
 * credentials, or PII is used. Names, dates, and relationships are
 * fabricated for testing purposes only.
 *
 * Command types are aligned with V1 IntentSchema / V1CommandTypeSchema:
 * query_birthday, query_phone, query_last_note.
 */
import type { ContactResolutionSummary, IntentBenchmarkCase } from "@monica-companion/types";

const sampleContacts: ContactResolutionSummary[] = [
	{
		contactId: 1,
		displayName: "Mary Johnson",
		aliases: ["Mary", "Johnson"],
		relationshipLabels: ["parent"],
		importantDates: [{ label: "birthdate", date: "1960-07-22", isYearUnknown: false }],
		lastInteractionAt: "2026-03-12T09:00:00Z",
	},
	{
		contactId: 2,
		displayName: "Alex Johnson",
		aliases: ["Alex", "Johnson"],
		relationshipLabels: ["sibling"],
		importantDates: [{ label: "birthdate", date: "1993-08-05", isYearUnknown: false }],
		lastInteractionAt: "2026-02-28T18:00:00Z",
	},
	{
		contactId: 3,
		displayName: "Sarah Miller",
		aliases: ["Sarah", "Miller"],
		relationshipLabels: ["friend"],
		importantDates: [{ label: "birthdate", date: "1992-04-12", isYearUnknown: false }],
		lastInteractionAt: "2026-01-15T10:00:00Z",
	},
];

export const readIntentCases: IntentBenchmarkCase[] = [
	{
		id: "ri-001",
		category: "read_intent",
		status: "active",
		description: "Ask for a contact's birthday",
		input: {
			utterance: "What's Sarah's birthday?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "query_birthday",
			contactRef: "Sarah",
			resolvedContactId: 3,
			isMutating: false,
		},
	},
	{
		id: "ri-002",
		category: "read_intent",
		status: "active",
		description: "Ask about the last note for a contact",
		input: {
			utterance: "What was the last note about Mom?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "query_last_note",
			contactRef: "Mom",
			resolvedContactId: 1,
			isMutating: false,
		},
	},
	{
		id: "ri-003",
		category: "read_intent",
		status: "active",
		description: "Ask for a contact's phone number",
		input: {
			utterance: "What's Alex's phone number?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "query_phone",
			contactRef: "Alex",
			resolvedContactId: 2,
			isMutating: false,
		},
	},
	{
		id: "ri-004",
		category: "read_intent",
		status: "active",
		description: "Ask for a contact's birthday using relationship label",
		input: {
			utterance: "When is my brother's birthday?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "query_birthday",
			contactRef: "brother",
			resolvedContactId: 2,
			isMutating: false,
		},
	},
];
