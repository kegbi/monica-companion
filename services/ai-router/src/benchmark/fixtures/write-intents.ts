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
 * 100 cases total:
 * - create_note: 25 cases (wi-001 to wi-025)
 * - create_contact: 15 cases (wi-026 to wi-040)
 * - create_activity: 20 cases (wi-041 to wi-060)
 * - update_contact_birthday: 10 cases (wi-061 to wi-070)
 * - update_contact_phone: 10 cases (wi-071 to wi-080)
 * - update_contact_email: 10 cases (wi-081 to wi-090)
 * - update_contact_address: 10 cases (wi-091 to wi-100)
 *
 * Includes:
 * - 20+ voice-style utterances (voiceSamplePath set)
 * - 10+ multi-language utterances
 * - 5+ compound commands
 * - 5+ ambiguous contacts
 * - 5+ relationship references
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
	{
		contactId: 5,
		displayName: "Sarah Chen",
		aliases: ["Sarah", "Chen"],
		relationshipLabels: ["colleague"],
		importantDates: [{ label: "birthdate", date: "1988-11-03", isYearUnknown: false }],
		lastInteractionAt: "2026-03-15T08:00:00Z",
	},
	{
		contactId: 6,
		displayName: "Alex Torres",
		aliases: ["Alex", "Torres"],
		relationshipLabels: ["friend"],
		importantDates: [],
		lastInteractionAt: "2026-03-01T12:00:00Z",
	},
	{
		contactId: 7,
		displayName: "David Park",
		aliases: ["David", "Park"],
		relationshipLabels: ["spouse"],
		importantDates: [{ label: "birthdate", date: "1985-06-14", isYearUnknown: false }],
		lastInteractionAt: "2026-03-18T20:00:00Z",
	},
	{
		contactId: 8,
		displayName: "Emma Watson",
		aliases: ["Emma", "Watson"],
		relationshipLabels: ["friend"],
		importantDates: [],
		lastInteractionAt: "2026-02-20T11:00:00Z",
	},
	{
		contactId: 9,
		displayName: "Carlos Rivera",
		aliases: ["Carlos", "Rivera"],
		relationshipLabels: ["colleague"],
		importantDates: [],
		lastInteractionAt: "2026-03-05T16:00:00Z",
	},
	{
		contactId: 10,
		displayName: "Yuki Tanaka",
		aliases: ["Yuki", "Tanaka"],
		relationshipLabels: ["friend"],
		importantDates: [{ label: "birthdate", date: "1994-09-25", isYearUnknown: false }],
		lastInteractionAt: null,
	},
];

export const writeIntentCases: IntentBenchmarkCase[] = [
	// ========================================================================
	// create_note: 25 cases (wi-001 to wi-025)
	// ========================================================================
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
		description: "Record a gift idea as a note",
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
		id: "wi-003",
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
	{
		id: "wi-004",
		category: "write_intent",
		status: "active",
		description: "Voice-style note about a contact preference",
		input: {
			utterance: "um hey remember that sarah likes dark chocolate not milk chocolate",
			voiceSamplePath: "voice/write_intent/wi-004.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "sarah",
			resolvedContactId: 3,
			isMutating: true,
		},
	},
	{
		id: "wi-005",
		category: "write_intent",
		status: "active",
		description: "Save a note about a medical appointment",
		input: {
			utterance: "Write a note that David has a dentist appointment next Tuesday",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "David",
			resolvedContactId: 4,
			isMutating: true,
		},
	},
	{
		id: "wi-006",
		category: "write_intent",
		status: "active",
		description: "Voice-style note with filler words",
		input: {
			utterance: "uh can you like write down that emma is allergic to peanuts",
			voiceSamplePath: "voice/write_intent/wi-006.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-007",
		category: "write_intent",
		status: "active",
		description: "Note about a work project",
		input: {
			utterance: "Make a note that Carlos is leading the Q2 marketing campaign",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Carlos",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-008",
		category: "write_intent",
		status: "active",
		description: "Note in Spanish",
		input: {
			utterance: "Anota que Carlos prefiere el cafe sin azucar",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Carlos",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-009",
		category: "write_intent",
		status: "active",
		description: "Voice-style note about travel plans",
		input: {
			utterance: "so yuki told me shes going to osaka in april make a note of that",
			voiceSamplePath: "voice/write_intent/wi-009.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "yuki",
			resolvedContactId: 10,
			isMutating: true,
		},
	},
	{
		id: "wi-010",
		category: "write_intent",
		status: "active",
		description: "Note about dietary preferences",
		input: {
			utterance: "Remember that Alex is now vegetarian",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Alex",
			resolvedContactId: 2,
			isMutating: true,
		},
	},
	{
		id: "wi-011",
		category: "write_intent",
		status: "active",
		description: "Compound command - note plus activity (primary: note)",
		input: {
			utterance: "Write a note about the concert and log that I went with Emma",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-012",
		category: "write_intent",
		status: "active",
		description: "Note in French",
		input: {
			utterance: "Note que Emma aime les films francais",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-013",
		category: "write_intent",
		status: "active",
		description: "Voice-style note with run-on sentence",
		input: {
			utterance:
				"hey just wanted to jot down that my husband said he wants a new bike for his birthday",
			voiceSamplePath: "voice/write_intent/wi-013.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "husband",
			resolvedContactId: 7,
			isMutating: true,
		},
	},
	{
		id: "wi-014",
		category: "write_intent",
		status: "active",
		description: "Note about a pet",
		input: {
			utterance: "Add a note that Sarah Miller got a new puppy named Biscuit",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Sarah Miller",
			resolvedContactId: 3,
			isMutating: true,
		},
	},
	{
		id: "wi-015",
		category: "write_intent",
		status: "active",
		description: "Voice-style ambiguous Sarah note",
		input: {
			utterance: "um make a note that sarah from work is transferring to the london office",
			voiceSamplePath: "voice/write_intent/wi-015.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "sarah from work",
			resolvedContactId: 5,
			isMutating: true,
		},
	},
	{
		id: "wi-016",
		category: "write_intent",
		status: "active",
		description: "Note about a hobby",
		input: {
			utterance: "Note that Alex Torres started learning guitar",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Alex Torres",
			resolvedContactId: 6,
			isMutating: true,
		},
	},
	{
		id: "wi-017",
		category: "write_intent",
		status: "active",
		description: "Note in German",
		input: {
			utterance: "Notiz fuer Emma: sie hat eine neue Wohnung in Berlin",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-018",
		category: "write_intent",
		status: "active",
		description: "Note with misspelling",
		input: {
			utterance: "Add a noet to Calros about the budget review",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Calros",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-019",
		category: "write_intent",
		status: "active",
		description: "Voice-style verbose note",
		input: {
			utterance:
				"okay so i need you to write something down about mom she said that she is thinking about retiring from her job at the hospital next year around march",
			voiceSamplePath: "voice/write_intent/wi-019.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "mom",
			resolvedContactId: 1,
			isMutating: true,
		},
	},
	{
		id: "wi-020",
		category: "write_intent",
		status: "active",
		description: "Note in Portuguese",
		input: {
			utterance: "Anota que Carlos vai viajar para o Brasil em julho",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Carlos",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-021",
		category: "write_intent",
		status: "active",
		description: "Voice-style note about job change",
		input: {
			utterance: "hey write down that david chen just got promoted to senior manager",
			voiceSamplePath: "voice/write_intent/wi-021.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "david chen",
			resolvedContactId: 4,
			isMutating: true,
		},
	},
	{
		id: "wi-022",
		category: "write_intent",
		status: "active",
		description: "Note using relationship reference (spouse)",
		input: {
			utterance: "Save a note that my husband wants to try the new Italian restaurant",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "husband",
			resolvedContactId: 7,
			isMutating: true,
		},
	},
	{
		id: "wi-023",
		category: "write_intent",
		status: "active",
		description: "Note in Japanese (romanized)",
		input: {
			utterance: "Yuki no memo: kanojo wa rainen kekkon suru yotei desu",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Yuki",
			resolvedContactId: 10,
			isMutating: true,
		},
	},
	{
		id: "wi-024",
		category: "write_intent",
		status: "active",
		description: "Voice-style note with abbreviation",
		input: {
			utterance: "note for alex j hes moving to nyc in sept",
			voiceSamplePath: "voice/write_intent/wi-024.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "alex j",
			resolvedContactId: 2,
			isMutating: true,
		},
	},
	{
		id: "wi-025",
		category: "write_intent",
		status: "active",
		description: "Note about a recommendation",
		input: {
			utterance: "Add a note that Yuki recommended the book Atomic Habits",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_note",
			contactRef: "Yuki",
			resolvedContactId: 10,
			isMutating: true,
		},
	},
	// ========================================================================
	// create_contact: 15 cases (wi-026 to wi-040)
	// ========================================================================
	{
		id: "wi-026",
		category: "write_intent",
		status: "active",
		description: "Create a new contact by full name",
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
		id: "wi-027",
		category: "write_intent",
		status: "active",
		description: "Add a new person to contacts",
		input: {
			utterance: "Add a new person named James Wong to my contacts",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "James Wong",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-028",
		category: "write_intent",
		status: "active",
		description: "Voice-style create contact",
		input: {
			utterance: "hey can you add a new contact for lisa martinez shes my new neighbor",
			voiceSamplePath: "voice/write_intent/wi-028.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "lisa martinez",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-029",
		category: "write_intent",
		status: "active",
		description: "Create contact in Spanish",
		input: {
			utterance: "Crear un contacto nuevo llamado Pedro Sanchez",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "Pedro Sanchez",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-030",
		category: "write_intent",
		status: "active",
		description: "Create contact with relationship context",
		input: {
			utterance: "Create a contact for my dentist Dr. Rachel Kim",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "Dr. Rachel Kim",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-031",
		category: "write_intent",
		status: "active",
		description: "Voice-style create contact with filler",
		input: {
			utterance: "um yeah i need to add uh mike thompson hes a guy from the gym",
			voiceSamplePath: "voice/write_intent/wi-031.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "mike thompson",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-032",
		category: "write_intent",
		status: "active",
		description: "Create contact with first name only",
		input: {
			utterance: "Add Priya as a new contact",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "Priya",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-033",
		category: "write_intent",
		status: "active",
		description: "Create contact in French",
		input: {
			utterance: "Ajouter un nouveau contact Jean-Pierre Dupont",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "Jean-Pierre Dupont",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-034",
		category: "write_intent",
		status: "active",
		description: "Compound command - create contact and add note (primary: create contact)",
		input: {
			utterance: "Create a contact for Natalie Brooks and note that she works at Acme Corp",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "Natalie Brooks",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-035",
		category: "write_intent",
		status: "active",
		description: "Voice-style create contact with spoken context",
		input: {
			utterance: "i met someone new today her name is aisha patel she works in accounting",
			voiceSamplePath: "voice/write_intent/wi-035.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "aisha patel",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-036",
		category: "write_intent",
		status: "active",
		description: "Create contact in German",
		input: {
			utterance: "Neuen Kontakt anlegen fuer Hans Mueller",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "Hans Mueller",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-037",
		category: "write_intent",
		status: "active",
		description: "Create contact with informal phrasing",
		input: {
			utterance: "I need to save a new contact for Ben Taylor",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "Ben Taylor",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-038",
		category: "write_intent",
		status: "active",
		description: "Voice-style create contact with name spelling",
		input: {
			utterance: "add a contact for olivia thats o l i v i a last name nguyen n g u y e n",
			voiceSamplePath: "voice/write_intent/wi-038.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "olivia nguyen",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-039",
		category: "write_intent",
		status: "active",
		description: "Create contact in Russian (romanized)",
		input: {
			utterance: "Dobav novyj kontakt Dmitrij Petrov",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "Dmitrij Petrov",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-040",
		category: "write_intent",
		status: "active",
		description: "Create contact with polite phrasing",
		input: {
			utterance: "Could you please add a new contact for my coworker Fatima Al-Hassan?",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_contact",
			contactRef: "Fatima Al-Hassan",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	// ========================================================================
	// create_activity: 20 cases (wi-041 to wi-060)
	// ========================================================================
	{
		id: "wi-041",
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
		id: "wi-042",
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
		id: "wi-043",
		category: "write_intent",
		status: "active",
		description: "Voice-style activity log",
		input: {
			utterance: "hey so i just got off a video call with carlos about the project timeline",
			voiceSamplePath: "voice/write_intent/wi-043.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "carlos",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-044",
		category: "write_intent",
		status: "active",
		description: "Log coffee meetup",
		input: {
			utterance: "Record that I had coffee with Emma this morning",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "Emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-045",
		category: "write_intent",
		status: "active",
		description: "Activity in Spanish",
		input: {
			utterance: "Registrar que almorcee con Carlos hoy",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "Carlos",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-046",
		category: "write_intent",
		status: "active",
		description: "Voice-style activity with filler words",
		input: {
			utterance: "uh i just um met up with yuki at the park you know like an hour ago",
			voiceSamplePath: "voice/write_intent/wi-046.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "yuki",
			resolvedContactId: 10,
			isMutating: true,
		},
	},
	{
		id: "wi-047",
		category: "write_intent",
		status: "active",
		description: "Log a dinner activity",
		input: {
			utterance: "We had dinner with Mom and Alex last night",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "Mom",
			resolvedContactId: 1,
			isMutating: true,
		},
	},
	{
		id: "wi-048",
		category: "write_intent",
		status: "active",
		description: "Log a birthday party activity",
		input: {
			utterance: "Log that I attended Sarah Chen's birthday party on Saturday",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "Sarah Chen",
			resolvedContactId: 5,
			isMutating: true,
		},
	},
	{
		id: "wi-049",
		category: "write_intent",
		status: "active",
		description: "Voice-style activity with relationship reference",
		input: {
			utterance: "my brother and i went hiking this weekend please log that",
			voiceSamplePath: "voice/write_intent/wi-049.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "brother",
			resolvedContactId: 2,
			isMutating: true,
		},
	},
	{
		id: "wi-050",
		category: "write_intent",
		status: "active",
		description: "Log a work meeting",
		input: {
			utterance: "Had a one-on-one with David Chen about performance reviews",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "David Chen",
			resolvedContactId: 4,
			isMutating: true,
		},
	},
	{
		id: "wi-051",
		category: "write_intent",
		status: "active",
		description: "Activity in French",
		input: {
			utterance: "J'ai pris un cafe avec Emma ce matin",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "Emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-052",
		category: "write_intent",
		status: "active",
		description: "Compound command - activity plus note (primary: activity)",
		input: {
			utterance: "Log that I met with Alex Torres and make a note he mentioned a new job",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "Alex Torres",
			resolvedContactId: 6,
			isMutating: true,
		},
	},
	{
		id: "wi-053",
		category: "write_intent",
		status: "active",
		description: "Voice-style activity log about texting",
		input: {
			utterance: "i texted with sarah miller earlier today about weekend plans",
			voiceSamplePath: "voice/write_intent/wi-053.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "sarah miller",
			resolvedContactId: 3,
			isMutating: true,
		},
	},
	{
		id: "wi-054",
		category: "write_intent",
		status: "active",
		description: "Log a gym session together",
		input: {
			utterance: "Went to the gym with Alex this afternoon",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "Alex",
			resolvedContactId: 2,
			isMutating: true,
		},
	},
	{
		id: "wi-055",
		category: "write_intent",
		status: "active",
		description: "Activity in Portuguese",
		input: {
			utterance: "Registra que eu encontrei com Carlos no escritorio ontem",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "Carlos",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-056",
		category: "write_intent",
		status: "active",
		description: "Voice-style activity with ambiguous David",
		input: {
			utterance: "so david and i watched the game together last night the david from work",
			voiceSamplePath: "voice/write_intent/wi-056.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "david from work",
			resolvedContactId: 4,
			isMutating: true,
		},
	},
	{
		id: "wi-057",
		category: "write_intent",
		status: "active",
		description: "Log a virtual event attendance",
		input: {
			utterance: "Attended a webinar with Yuki on AI trends",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "Yuki",
			resolvedContactId: 10,
			isMutating: true,
		},
	},
	{
		id: "wi-058",
		category: "write_intent",
		status: "active",
		description: "Log a walk activity",
		input: {
			utterance: "Went for a walk with my spouse in the evening",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "spouse",
			resolvedContactId: 7,
			isMutating: true,
		},
	},
	{
		id: "wi-059",
		category: "write_intent",
		status: "active",
		description: "Voice-style activity log with spoken date",
		input: {
			utterance: "i had brunch with emma on march fifteenth at that cafe downtown",
			voiceSamplePath: "voice/write_intent/wi-059.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-060",
		category: "write_intent",
		status: "active",
		description: "Activity in Japanese (romanized)",
		input: {
			utterance: "Yuki to issho ni ranchi wo tabemashita",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "create_activity",
			contactRef: "Yuki",
			resolvedContactId: 10,
			isMutating: true,
		},
	},
	// ========================================================================
	// update_contact_birthday: 10 cases (wi-061 to wi-070)
	// ========================================================================
	{
		id: "wi-061",
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
		id: "wi-062",
		category: "write_intent",
		status: "active",
		description: "Set birthday with full date",
		input: {
			utterance: "Set Emma's birthday to December 3rd 1990",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_birthday",
			contactRef: "Emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-063",
		category: "write_intent",
		status: "active",
		description: "Voice-style birthday update with spoken date",
		input: {
			utterance: "hey carlos birthday is on the twenty second of january nineteen eighty five",
			voiceSamplePath: "voice/write_intent/wi-063.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_birthday",
			contactRef: "carlos",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-064",
		category: "write_intent",
		status: "active",
		description: "Birthday update using relationship label",
		input: {
			utterance: "My sister's birthday is on March 5th",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_birthday",
			contactRef: "sister",
			resolvedContactId: null,
			isMutating: true,
		},
	},
	{
		id: "wi-065",
		category: "write_intent",
		status: "active",
		description: "Birthday update in Spanish",
		input: {
			utterance: "El cumpleanos de Carlos es el quince de agosto",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_birthday",
			contactRef: "Carlos",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-066",
		category: "write_intent",
		status: "active",
		description: "Voice-style birthday with day-month format",
		input: {
			utterance: "um yukis birthday is may tenth but im not sure about the year",
			voiceSamplePath: "voice/write_intent/wi-066.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_birthday",
			contactRef: "yuki",
			resolvedContactId: 10,
			isMutating: true,
		},
	},
	{
		id: "wi-067",
		category: "write_intent",
		status: "active",
		description: "Correct a birthday",
		input: {
			utterance: "Fix Sarah Miller's birthday, it should be April 15th not the 12th",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_birthday",
			contactRef: "Sarah Miller",
			resolvedContactId: 3,
			isMutating: true,
		},
	},
	{
		id: "wi-068",
		category: "write_intent",
		status: "active",
		description: "Birthday update with ambiguous David",
		input: {
			utterance: "David Park's birthday is June 14",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_birthday",
			contactRef: "David Park",
			resolvedContactId: 7,
			isMutating: true,
		},
	},
	{
		id: "wi-069",
		category: "write_intent",
		status: "active",
		description: "Birthday update for Mom",
		input: {
			utterance: "Change Mom's birthday to July 22nd",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_birthday",
			contactRef: "Mom",
			resolvedContactId: 1,
			isMutating: true,
		},
	},
	{
		id: "wi-070",
		category: "write_intent",
		status: "active",
		description: "Voice-style birthday update with filler",
		input: {
			utterance: "uh so alex torres told me his birthday is actually november third not the fifth",
			voiceSamplePath: "voice/write_intent/wi-070.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_birthday",
			contactRef: "alex torres",
			resolvedContactId: 6,
			isMutating: true,
		},
	},
	// ========================================================================
	// update_contact_phone: 10 cases (wi-071 to wi-080)
	// ========================================================================
	{
		id: "wi-071",
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
		id: "wi-072",
		category: "write_intent",
		status: "active",
		description: "Voice-style phone update with spoken digits",
		input: {
			utterance: "emmas new number is five five five zero one two three",
			voiceSamplePath: "voice/write_intent/wi-072.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_phone",
			contactRef: "emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-073",
		category: "write_intent",
		status: "active",
		description: "Change phone number with full format",
		input: {
			utterance: "Change Carlos's phone to +1-555-0145",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_phone",
			contactRef: "Carlos",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-074",
		category: "write_intent",
		status: "active",
		description: "Phone update for Mom",
		input: {
			utterance: "Mom has a new phone number: 555-0188",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_phone",
			contactRef: "Mom",
			resolvedContactId: 1,
			isMutating: true,
		},
	},
	{
		id: "wi-075",
		category: "write_intent",
		status: "active",
		description: "Voice-style phone update with context",
		input: {
			utterance: "hey alex just got a new phone his number is five five five zero three four five",
			voiceSamplePath: "voice/write_intent/wi-075.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_phone",
			contactRef: "alex",
			resolvedContactId: 2,
			isMutating: true,
		},
	},
	{
		id: "wi-076",
		category: "write_intent",
		status: "active",
		description: "Phone update in French",
		input: {
			utterance: "Le nouveau numero de telephone d'Emma est 06 12 34 56 78",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_phone",
			contactRef: "Emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-077",
		category: "write_intent",
		status: "active",
		description: "Compound command - phone and email update (primary: phone)",
		input: {
			utterance: "Update David Chen's phone to 555-0167 and his email too",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_phone",
			contactRef: "David Chen",
			resolvedContactId: 4,
			isMutating: true,
		},
	},
	{
		id: "wi-078",
		category: "write_intent",
		status: "active",
		description: "Phone update with cell specification",
		input: {
			utterance: "Save Yuki's cell phone number as 555-0234",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_phone",
			contactRef: "Yuki",
			resolvedContactId: 10,
			isMutating: true,
		},
	},
	{
		id: "wi-079",
		category: "write_intent",
		status: "active",
		description: "Voice-style phone with relationship reference",
		input: {
			utterance: "my husbands new work phone is five five five zero nine eight seven",
			voiceSamplePath: "voice/write_intent/wi-079.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_phone",
			contactRef: "husband",
			resolvedContactId: 7,
			isMutating: true,
		},
	},
	{
		id: "wi-080",
		category: "write_intent",
		status: "active",
		description: "Phone update with ambiguous Sarah",
		input: {
			utterance: "Sarah Chen's new number is 555-0278",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_phone",
			contactRef: "Sarah Chen",
			resolvedContactId: 5,
			isMutating: true,
		},
	},
	// ========================================================================
	// update_contact_email: 10 cases (wi-081 to wi-090)
	// ========================================================================
	{
		id: "wi-081",
		category: "write_intent",
		status: "active",
		description: "Update email address",
		input: {
			utterance: "Update Emma's email to emma.watson@example.com",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_email",
			contactRef: "Emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-082",
		category: "write_intent",
		status: "active",
		description: "Voice-style email update with spoken address",
		input: {
			utterance: "carlos new email is carlos dot rivera at gmail dot com",
			voiceSamplePath: "voice/write_intent/wi-082.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_email",
			contactRef: "carlos",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-083",
		category: "write_intent",
		status: "active",
		description: "Change email with formal phrasing",
		input: {
			utterance: "Please change David Chen's email address to dchen@techcorp.com",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_email",
			contactRef: "David Chen",
			resolvedContactId: 4,
			isMutating: true,
		},
	},
	{
		id: "wi-084",
		category: "write_intent",
		status: "active",
		description: "Email update for sibling",
		input: {
			utterance: "My brother's new email is alexj@example.org",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_email",
			contactRef: "brother",
			resolvedContactId: 2,
			isMutating: true,
		},
	},
	{
		id: "wi-085",
		category: "write_intent",
		status: "active",
		description: "Email update in Spanish",
		input: {
			utterance: "El correo nuevo de Carlos es carlos@empresa.es",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_email",
			contactRef: "Carlos",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-086",
		category: "write_intent",
		status: "active",
		description: "Voice-style email update with filler",
		input: {
			utterance: "uh yukis email changed its now yuki underscore tanaka at yahoo dot com",
			voiceSamplePath: "voice/write_intent/wi-086.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_email",
			contactRef: "yuki",
			resolvedContactId: 10,
			isMutating: true,
		},
	},
	{
		id: "wi-087",
		category: "write_intent",
		status: "active",
		description: "Set work email address",
		input: {
			utterance: "Set Sarah Miller's work email to smiller@designco.com",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_email",
			contactRef: "Sarah Miller",
			resolvedContactId: 3,
			isMutating: true,
		},
	},
	{
		id: "wi-088",
		category: "write_intent",
		status: "active",
		description: "Email update with ambiguous Alex",
		input: {
			utterance: "Alex Torres email is atorres@startup.io",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_email",
			contactRef: "Alex Torres",
			resolvedContactId: 6,
			isMutating: true,
		},
	},
	{
		id: "wi-089",
		category: "write_intent",
		status: "active",
		description: "Email update for Mom",
		input: {
			utterance: "Mom's email is now mary.johnson@mail.com",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_email",
			contactRef: "Mom",
			resolvedContactId: 1,
			isMutating: true,
		},
	},
	{
		id: "wi-090",
		category: "write_intent",
		status: "active",
		description: "Compound command - email and phone update (primary: email)",
		input: {
			utterance: "Update David Park's email to dpark@home.net and also his phone number",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_email",
			contactRef: "David Park",
			resolvedContactId: 7,
			isMutating: true,
		},
	},
	// ========================================================================
	// update_contact_address: 10 cases (wi-091 to wi-100)
	// ========================================================================
	{
		id: "wi-091",
		category: "write_intent",
		status: "active",
		description: "Update home address",
		input: {
			utterance: "Update Emma's address to 123 Oak Street, Portland, OR 97201",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_address",
			contactRef: "Emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-092",
		category: "write_intent",
		status: "active",
		description: "Voice-style address update",
		input: {
			utterance:
				"sarah millers new address is four fifty six maple avenue apartment three b chicago",
			voiceSamplePath: "voice/write_intent/wi-092.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_address",
			contactRef: "sarah miller",
			resolvedContactId: 3,
			isMutating: true,
		},
	},
	{
		id: "wi-093",
		category: "write_intent",
		status: "active",
		description: "Change address with formal phrasing",
		input: {
			utterance: "Please change Carlos's address to 789 Pine Road, Austin, TX 73301",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_address",
			contactRef: "Carlos",
			resolvedContactId: 9,
			isMutating: true,
		},
	},
	{
		id: "wi-094",
		category: "write_intent",
		status: "active",
		description: "Address update for Mom",
		input: {
			utterance: "Mom moved to 321 Elm Drive, Seattle, WA 98101",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_address",
			contactRef: "Mom",
			resolvedContactId: 1,
			isMutating: true,
		},
	},
	{
		id: "wi-095",
		category: "write_intent",
		status: "active",
		description: "Voice-style address with spoken numbers",
		input: {
			utterance: "alexs new place is seven eight nine broadway unit twelve new york city",
			voiceSamplePath: "voice/write_intent/wi-095.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_address",
			contactRef: "alex",
			resolvedContactId: 2,
			isMutating: true,
		},
	},
	{
		id: "wi-096",
		category: "write_intent",
		status: "active",
		description: "Address update in German",
		input: {
			utterance: "Emmas neue Adresse ist Hauptstrasse 42, Berlin",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_address",
			contactRef: "Emma",
			resolvedContactId: 8,
			isMutating: true,
		},
	},
	{
		id: "wi-097",
		category: "write_intent",
		status: "active",
		description: "Address update with relationship reference",
		input: {
			utterance: "My husband moved to 555 Cedar Lane, Denver, CO 80201",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_address",
			contactRef: "husband",
			resolvedContactId: 7,
			isMutating: true,
		},
	},
	{
		id: "wi-098",
		category: "write_intent",
		status: "active",
		description: "Address update with ambiguous David",
		input: {
			utterance: "David Chen's new address is 100 Market Street, San Francisco, CA 94105",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_address",
			contactRef: "David Chen",
			resolvedContactId: 4,
			isMutating: true,
		},
	},
	{
		id: "wi-099",
		category: "write_intent",
		status: "active",
		description: "Voice-style address with run-on",
		input: {
			utterance:
				"so yuki just moved her new address is one two three sakura street apartment five tokyo",
			voiceSamplePath: "voice/write_intent/wi-099.ogg",
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_address",
			contactRef: "yuki",
			resolvedContactId: 10,
			isMutating: true,
		},
	},
	{
		id: "wi-100",
		category: "write_intent",
		status: "active",
		description: "Compound command - address and note (primary: address)",
		input: {
			utterance: "Update Alex Torres's address to 200 Sunset Blvd LA and note he bought a condo",
			voiceSamplePath: null,
			contactContext: sampleContacts,
		},
		expected: {
			commandType: "update_contact_address",
			contactRef: "Alex Torres",
			resolvedContactId: 6,
			isMutating: true,
		},
	},
];
