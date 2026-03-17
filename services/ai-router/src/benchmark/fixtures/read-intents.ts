/**
 * Read intent benchmark fixture stubs.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. No real user data, API keys,
 * credentials, or PII is used. Names, dates, and relationships are
 * fabricated for testing purposes only.
 *
 * These cases are status: "pending" until the LangGraph intent
 * classification pipeline is built (Phase 3+).
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
		status: "pending",
		description: "Ask for a contact's birthday",
		input: {
			utterance: "What's Sarah's birthday?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "get_birthday",
			contactRef: "Sarah",
			resolvedContactId: 3,
			isMutating: false,
		},
	},
	{
		id: "ri-002",
		category: "read_intent",
		status: "pending",
		description: "Ask about last interaction",
		input: {
			utterance: "When did I last talk to Mom?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "get_last_activity",
			contactRef: "Mom",
			resolvedContactId: 1,
			isMutating: false,
		},
	},
	{
		id: "ri-003",
		category: "read_intent",
		status: "pending",
		description: "Ask for upcoming birthdays",
		input: {
			utterance: "Who has a birthday this month?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "list_birthdays",
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "ri-004",
		category: "read_intent",
		status: "pending",
		description: "Get contact details",
		input: {
			utterance: "Tell me about Alex",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "get_contact",
			contactRef: "Alex",
			resolvedContactId: 2,
			isMutating: false,
		},
	},
	{
		id: "ri-005",
		category: "read_intent",
		status: "pending",
		description: "List recent activities",
		input: {
			utterance: "What did I do with Sarah recently?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "list_activities",
			contactRef: "Sarah",
			resolvedContactId: 3,
			isMutating: false,
		},
	},
	{
		id: "ri-006",
		category: "read_intent",
		status: "pending",
		description: "Ask for reminders",
		input: {
			utterance: "What reminders do I have?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "list_reminders",
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
];
