/**
 * Write intent benchmark fixtures.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. No real user data, API keys,
 * credentials, or PII is used. Names, dates, and relationships are
 * fabricated for testing purposes only.
 *
 * Command types are aligned with V1 IntentSchema / V1CommandTypeSchema:
 * create_contact, create_note, create_activity, update_contact_birthday,
 * update_contact_phone, update_contact_email, update_contact_address.
 *
 * Non-V1 types (create_reminder, create_task) have been removed.
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
		importantDates: [],
		lastInteractionAt: "2026-02-28T18:00:00Z",
	},
	{
		contactId: 3,
		displayName: "Sarah Miller",
		aliases: ["Sarah", "Miller"],
		relationshipLabels: ["friend"],
		importantDates: [{ label: "birthdate", date: "1992-04-12", isYearUnknown: false }],
		lastInteractionAt: null,
	},
	{
		contactId: 4,
		displayName: "David Chen",
		aliases: ["David", "Chen"],
		relationshipLabels: ["colleague"],
		importantDates: [],
		lastInteractionAt: "2026-03-10T14:30:00Z",
	},
];

export const writeIntentCases: IntentBenchmarkCase[] = [
	{
		id: "wi-001",
		category: "write_intent",
		status: "active",
		description: "Add a note to a contact by relationship label",
		input: {
			utterance: "Add a note to Mom about her garden project",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Mom",
			resolvedContactId: 1,
			isMutating: true,
		},
	},
	{
		id: "wi-002",
		category: "write_intent",
		status: "active",
		description: "Create a new contact by name",
		input: {
			utterance: "Create a contact named Sarah Miller",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "Sarah Miller",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-003",
		category: "write_intent",
		status: "active",
		description: "Update a birthday for a specific contact",
		input: {
			utterance: "Update Alex's birthday to April 12",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_birthday",
			contactRef: "Alex",
			resolvedContactId: 2,
			isMutating: true,
		},
	},
	{
		id: "wi-004",
		category: "write_intent",
		status: "active",
		description: "Log a phone call activity",
		input: {
			utterance: "Log that I called Sarah yesterday",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "Sarah",
			resolvedContactId: 3,
			isMutating: true,
		},
	},
	{
		id: "wi-006",
		category: "write_intent",
		status: "active",
		description: "Add a gift idea to a contact",
		input: {
			utterance: "Add gift idea for Mom: new gardening tools",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Mom",
			resolvedContactId: 1,
			isMutating: true,
		},
	},
	{
		id: "wi-007",
		category: "write_intent",
		status: "active",
		description: "Update a phone number",
		input: {
			utterance: "Update Sarah's phone number to 555-0199",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_phone",
			contactRef: "Sarah",
			resolvedContactId: 3,
			isMutating: true,
		},
	},
	{
		id: "wi-008",
		category: "write_intent",
		status: "active",
		description: "Log a meeting activity",
		input: {
			utterance: "I had lunch with David today",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "David",
			resolvedContactId: 4,
			isMutating: true,
		},
	},
	{
		id: "wi-010",
		category: "write_intent",
		status: "active",
		description: "Record a conversation note",
		input: {
			utterance: "Note: Mom mentioned she wants to visit in June",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Mom",
			resolvedContactId: 1,
			isMutating: true,
		},
	},
];
