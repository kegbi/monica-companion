/**
 * Contact resolution benchmark fixtures.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. No real user data, API keys,
 * credentials, or PII is used. Names, dates, and relationships are
 * fabricated for testing purposes only.
 */
import type {
	ContactResolutionBenchmarkCase,
	ContactResolutionSummary,
} from "@monica-companion/types";

/** Shared simulated contact list reused across many benchmark cases. */
const sharedContacts: ContactResolutionSummary[] = [
	{
		contactId: 1,
		displayName: "John Doe (Johnny)",
		aliases: ["Johnny", "John", "Doe"],
		relationshipLabels: ["friend"],
		importantDates: [{ label: "birthdate", date: "1985-03-15", isYearUnknown: false }],
		lastInteractionAt: "2026-03-10T14:30:00Z",
	},
	{
		contactId: 2,
		displayName: "Maria Smith (Mary)",
		aliases: ["Mary", "Maria", "Smith"],
		relationshipLabels: ["parent"],
		importantDates: [{ label: "birthdate", date: "1960-07-22", isYearUnknown: false }],
		lastInteractionAt: "2026-03-12T09:00:00Z",
	},
	{
		contactId: 3,
		displayName: "Alex Johnson",
		aliases: ["Alex", "Johnson"],
		relationshipLabels: ["sibling"],
		importantDates: [],
		lastInteractionAt: "2026-02-28T18:00:00Z",
	},
	{
		contactId: 4,
		displayName: "Sarah Williams",
		aliases: ["Sarah", "Williams"],
		relationshipLabels: ["colleague"],
		importantDates: [{ label: "birthdate", date: "1992-11-03", isYearUnknown: false }],
		lastInteractionAt: null,
	},
	{
		contactId: 5,
		displayName: "Jane Doe",
		aliases: ["Jane", "Doe"],
		relationshipLabels: ["spouse"],
		importantDates: [{ label: "birthdate", date: "1987-06-18", isYearUnknown: false }],
		lastInteractionAt: "2026-03-15T20:00:00Z",
	},
	{
		contactId: 6,
		displayName: "Bob Builder",
		aliases: ["Bob", "Builder"],
		relationshipLabels: ["boss"],
		importantDates: [],
		lastInteractionAt: "2026-01-20T10:00:00Z",
	},
	{
		contactId: 7,
		displayName: "Emily Chen",
		aliases: ["Emily", "Chen"],
		relationshipLabels: ["bestfriend"],
		importantDates: [{ label: "birthdate", date: "1990-04-10", isYearUnknown: false }],
		lastInteractionAt: "2026-03-14T16:00:00Z",
	},
	{
		contactId: 8,
		displayName: "Carlos Garcia",
		aliases: ["Carlos", "Garcia"],
		relationshipLabels: ["cousin"],
		importantDates: [],
		lastInteractionAt: null,
	},
	{
		contactId: 9,
		displayName: "Nana Rose",
		aliases: ["Nana", "Rose"],
		relationshipLabels: ["grandparent"],
		importantDates: [{ label: "birthdate", date: "1945-12-25", isYearUnknown: false }],
		lastInteractionAt: "2026-02-14T12:00:00Z",
	},
	{
		contactId: 10,
		displayName: "Tom Wilson",
		aliases: ["Tom", "Wilson"],
		relationshipLabels: ["mentor"],
		importantDates: [],
		lastInteractionAt: "2026-03-01T08:00:00Z",
	},
];

/** Contacts used for ambiguous-name test cases. */
const ambiguousContacts: ContactResolutionSummary[] = [
	{
		contactId: 20,
		displayName: "Sherry Miller",
		aliases: ["Sherry", "Miller"],
		relationshipLabels: ["friend"],
		importantDates: [],
		lastInteractionAt: null,
	},
	{
		contactId: 21,
		displayName: "Sherry Chen",
		aliases: ["Sherry", "Chen"],
		relationshipLabels: ["colleague"],
		importantDates: [],
		lastInteractionAt: "2026-03-10T14:30:00Z",
	},
	{
		contactId: 22,
		displayName: "Alex Torres",
		aliases: ["Alex", "Torres"],
		relationshipLabels: [],
		importantDates: [],
		lastInteractionAt: "2026-03-05T10:00:00Z",
	},
	{
		contactId: 23,
		displayName: "Alex Kim",
		aliases: ["Alex", "Kim"],
		relationshipLabels: [],
		importantDates: [],
		lastInteractionAt: null,
	},
];

export const contactResolutionCases: ContactResolutionBenchmarkCase[] = [
	// ---- Exact display name match (5 cases) ----
	{
		id: "cr-001",
		category: "contact_resolution",
		status: "active",
		description: "Exact display name match with parenthetical",
		input: { query: "John Doe (Johnny)", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 1, candidateContactIds: [] },
	},
	{
		id: "cr-002",
		category: "contact_resolution",
		status: "active",
		description: "Exact display name match stripping parenthetical",
		input: { query: "John Doe", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 1, candidateContactIds: [] },
	},
	{
		id: "cr-003",
		category: "contact_resolution",
		status: "active",
		description: "Exact display name match - Maria Smith (Mary)",
		input: { query: "Maria Smith", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 2, candidateContactIds: [] },
	},
	{
		id: "cr-004",
		category: "contact_resolution",
		status: "active",
		description: "Exact display name match - case insensitive",
		input: { query: "jane doe", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 5, candidateContactIds: [] },
	},
	{
		id: "cr-005",
		category: "contact_resolution",
		status: "active",
		description: "Exact display name match - Emily Chen",
		input: { query: "Emily Chen", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 7, candidateContactIds: [] },
	},

	// ---- First + last name match from aliases (4 cases) ----
	{
		id: "cr-006",
		category: "contact_resolution",
		status: "active",
		description: "First+last alias match when display has middle name",
		input: {
			query: "John Doe",
			contacts: [
				{
					contactId: 50,
					displayName: "John Michael Doe",
					aliases: ["John", "Doe"],
					relationshipLabels: [],
					importantDates: [],
					lastInteractionAt: null,
				},
			],
		},
		expected: { outcome: "resolved", resolvedContactId: 50, candidateContactIds: [] },
	},
	{
		id: "cr-007",
		category: "contact_resolution",
		status: "active",
		description: "First+last alias match - Carlos Garcia",
		input: { query: "Carlos Garcia", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 8, candidateContactIds: [] },
	},
	{
		id: "cr-008",
		category: "contact_resolution",
		status: "active",
		description: "First+last alias match - Tom Wilson",
		input: { query: "Tom Wilson", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 10, candidateContactIds: [] },
	},
	{
		id: "cr-009",
		category: "contact_resolution",
		status: "active",
		description: "First+last alias match - Sarah Williams",
		input: { query: "Sarah Williams", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 4, candidateContactIds: [] },
	},

	// ---- Relationship label match (6 cases) ----
	{
		id: "cr-010",
		category: "contact_resolution",
		status: "active",
		description: "Relationship label - Mom matches parent",
		input: { query: "Mom", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 2, candidateContactIds: [] },
	},
	{
		id: "cr-011",
		category: "contact_resolution",
		status: "active",
		description: "Relationship label - brother matches sibling",
		input: { query: "my brother", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 3, candidateContactIds: [] },
	},
	{
		id: "cr-012",
		category: "contact_resolution",
		status: "active",
		description: "Relationship label - wife matches spouse",
		input: { query: "wife", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 5, candidateContactIds: [] },
	},
	{
		id: "cr-013",
		category: "contact_resolution",
		status: "active",
		description: "Relationship label - boss matches boss",
		input: { query: "boss", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 6, candidateContactIds: [] },
	},
	{
		id: "cr-014",
		category: "contact_resolution",
		status: "active",
		description: "Relationship label - colleague matches colleague",
		input: { query: "colleague", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 4, candidateContactIds: [] },
	},
	{
		id: "cr-015",
		category: "contact_resolution",
		status: "active",
		description: "Relationship label - cousin matches cousin",
		input: { query: "cousin", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 8, candidateContactIds: [] },
	},

	// ---- Kinship normalization (6 cases) ----
	{
		id: "cr-016",
		category: "contact_resolution",
		status: "active",
		description: "Kinship normalization - mama matches parent",
		input: { query: "mama", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 2, candidateContactIds: [] },
	},
	{
		id: "cr-017",
		category: "contact_resolution",
		status: "active",
		description: "Kinship normalization - sis matches sibling",
		input: {
			query: "sis",
			contacts: [
				{
					contactId: 60,
					displayName: "Anna Park",
					aliases: ["Anna", "Park"],
					relationshipLabels: ["sibling"],
					importantDates: [],
					lastInteractionAt: null,
				},
			],
		},
		expected: { outcome: "resolved", resolvedContactId: 60, candidateContactIds: [] },
	},
	{
		id: "cr-018",
		category: "contact_resolution",
		status: "active",
		description:
			"Kinship normalization - hubby is NOT in KINSHIP_MAP. This is a deliberate no_match edge case: 'hubby' is a common colloquial term not currently mapped.",
		input: {
			query: "hubby",
			contacts: [
				{
					contactId: 61,
					displayName: "David Park",
					aliases: ["David", "Park"],
					relationshipLabels: ["spouse"],
					importantDates: [],
					lastInteractionAt: null,
				},
			],
		},
		expected: { outcome: "no_match", resolvedContactId: null, candidateContactIds: [] },
	},
	{
		id: "cr-019",
		category: "contact_resolution",
		status: "active",
		description: "Kinship normalization - coworker matches colleague",
		input: { query: "coworker", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 4, candidateContactIds: [] },
	},
	{
		id: "cr-020",
		category: "contact_resolution",
		status: "active",
		description: "Kinship normalization - bff matches bestfriend",
		input: { query: "bff", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 7, candidateContactIds: [] },
	},
	{
		id: "cr-021",
		category: "contact_resolution",
		status: "active",
		description: "Kinship normalization - buddy matches friend",
		input: { query: "buddy", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 1, candidateContactIds: [] },
	},

	// ---- Single alias/nickname match (4 cases) ----
	// Note: alias matches score 0.8, which is below RESOLVED_THRESHOLD (0.9).
	// With a single candidate at 0.8, the outcome is "ambiguous" not "resolved".
	// Use isolated contacts to test single-alias behavior precisely.
	{
		id: "cr-022",
		category: "contact_resolution",
		status: "active",
		description: "Alias match - Johnny scores 0.8 (ambiguous with single candidate)",
		input: {
			query: "Johnny",
			contacts: [
				{
					contactId: 80,
					displayName: "John Doe (Johnny)",
					aliases: ["Johnny", "John", "Doe"],
					relationshipLabels: [],
					importantDates: [],
					lastInteractionAt: null,
				},
			],
		},
		expected: { outcome: "ambiguous", resolvedContactId: null, candidateContactIds: [80] },
	},
	{
		id: "cr-023",
		category: "contact_resolution",
		status: "active",
		description: "Alias match - Mary scores 0.8 (ambiguous with single candidate)",
		input: {
			query: "Mary",
			contacts: [
				{
					contactId: 81,
					displayName: "Maria Smith (Mary)",
					aliases: ["Mary", "Maria", "Smith"],
					relationshipLabels: [],
					importantDates: [],
					lastInteractionAt: null,
				},
			],
		},
		expected: { outcome: "ambiguous", resolvedContactId: null, candidateContactIds: [81] },
	},
	{
		id: "cr-024",
		category: "contact_resolution",
		status: "active",
		description: "Alias match - Bob scores 0.8 (ambiguous with single candidate)",
		input: {
			query: "Bob",
			contacts: [
				{
					contactId: 82,
					displayName: "Bob Builder",
					aliases: ["Bob", "Builder"],
					relationshipLabels: [],
					importantDates: [],
					lastInteractionAt: null,
				},
			],
		},
		expected: { outcome: "ambiguous", resolvedContactId: null, candidateContactIds: [82] },
	},
	{
		id: "cr-025",
		category: "contact_resolution",
		status: "active",
		description:
			"Alias+relationship - Nana also matches grandparent via KINSHIP_MAP (resolved at 0.9)",
		input: { query: "Nana", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 9, candidateContactIds: [] },
	},

	// ---- Prefix match (3 cases) ----
	{
		id: "cr-026",
		category: "contact_resolution",
		status: "active",
		description: "Prefix match - Joh for John",
		input: {
			query: "Joh",
			contacts: [
				{
					contactId: 70,
					displayName: "John Adams",
					aliases: ["John", "Adams"],
					relationshipLabels: [],
					importantDates: [],
					lastInteractionAt: null,
				},
			],
		},
		expected: { outcome: "ambiguous", resolvedContactId: null, candidateContactIds: [70] },
	},
	{
		id: "cr-027",
		category: "contact_resolution",
		status: "active",
		description: "Prefix match - Al for Alex",
		input: {
			query: "Al",
			contacts: [
				{
					contactId: 71,
					displayName: "Alex Brown",
					aliases: ["Alex", "Brown"],
					relationshipLabels: [],
					importantDates: [],
					lastInteractionAt: null,
				},
			],
		},
		expected: { outcome: "ambiguous", resolvedContactId: null, candidateContactIds: [71] },
	},
	{
		id: "cr-028",
		category: "contact_resolution",
		status: "active",
		description: "Prefix match - Em for Emily",
		input: {
			query: "Em",
			contacts: [
				{
					contactId: 72,
					displayName: "Emily Davis",
					aliases: ["Emily", "Davis"],
					relationshipLabels: [],
					importantDates: [],
					lastInteractionAt: null,
				},
			],
		},
		expected: { outcome: "ambiguous", resolvedContactId: null, candidateContactIds: [72] },
	},

	// ---- Ambiguous duplicate names (5 cases) ----
	{
		id: "cr-029",
		category: "contact_resolution",
		status: "active",
		description: "Ambiguous - two Sherrys",
		input: { query: "Sherry", contacts: ambiguousContacts },
		expected: {
			outcome: "ambiguous",
			resolvedContactId: null,
			candidateContactIds: [21, 20],
		},
	},
	{
		id: "cr-030",
		category: "contact_resolution",
		status: "active",
		description: "Ambiguous - two Alexes",
		input: { query: "Alex", contacts: ambiguousContacts },
		expected: {
			outcome: "ambiguous",
			resolvedContactId: null,
			candidateContactIds: [22, 23],
		},
	},
	{
		id: "cr-031",
		category: "contact_resolution",
		status: "active",
		description: "Ambiguous - disambiguation by full name resolves Sherry Miller",
		input: { query: "Sherry Miller", contacts: ambiguousContacts },
		expected: { outcome: "resolved", resolvedContactId: 20, candidateContactIds: [] },
	},
	{
		id: "cr-032",
		category: "contact_resolution",
		status: "active",
		description: "Ambiguous - disambiguation by full name resolves Alex Torres",
		input: { query: "Alex Torres", contacts: ambiguousContacts },
		expected: { outcome: "resolved", resolvedContactId: 22, candidateContactIds: [] },
	},
	{
		id: "cr-033",
		category: "contact_resolution",
		status: "active",
		description: "Ambiguous - disambiguation by full name resolves Alex Kim",
		input: { query: "Alex Kim", contacts: ambiguousContacts },
		expected: { outcome: "resolved", resolvedContactId: 23, candidateContactIds: [] },
	},

	// ---- No match (4 cases) ----
	{
		id: "cr-034",
		category: "contact_resolution",
		status: "active",
		description: "No match - Xavier against shared contacts",
		input: { query: "Xavier", contacts: sharedContacts },
		expected: { outcome: "no_match", resolvedContactId: null, candidateContactIds: [] },
	},
	{
		id: "cr-035",
		category: "contact_resolution",
		status: "active",
		description: "No match - against empty contact list",
		input: { query: "Anyone", contacts: [] },
		expected: { outcome: "no_match", resolvedContactId: null, candidateContactIds: [] },
	},
	{
		id: "cr-036",
		category: "contact_resolution",
		status: "active",
		description: "No match - Zoe not in contacts",
		input: { query: "Zoe", contacts: sharedContacts },
		expected: { outcome: "no_match", resolvedContactId: null, candidateContactIds: [] },
	},
	{
		id: "cr-037",
		category: "contact_resolution",
		status: "active",
		description: "No match - completely unrelated term",
		input: { query: "refrigerator", contacts: sharedContacts },
		expected: { outcome: "no_match", resolvedContactId: null, candidateContactIds: [] },
	},

	// ---- Compound queries (3 cases) ----
	{
		id: "cr-038",
		category: "contact_resolution",
		status: "active",
		description: "Compound query - brother Alex narrows to sibling",
		input: { query: "brother Alex", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 3, candidateContactIds: [] },
	},
	{
		id: "cr-039",
		category: "contact_resolution",
		status: "active",
		description: "Compound query - Mom Maria resolves via relationship + name",
		input: { query: "Mom Maria", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 2, candidateContactIds: [] },
	},
	{
		id: "cr-040",
		category: "contact_resolution",
		status: "active",
		description: "Compound query - friend John resolves via relationship + name",
		input: { query: "friend John", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 1, candidateContactIds: [] },
	},

	// ---- Edge cases (5 cases) ----
	{
		id: "cr-041",
		category: "contact_resolution",
		status: "active",
		description: "Edge case - empty query returns no match",
		input: { query: "", contacts: sharedContacts },
		expected: { outcome: "no_match", resolvedContactId: null, candidateContactIds: [] },
	},
	{
		id: "cr-042",
		category: "contact_resolution",
		status: "active",
		description: "Edge case - single char does not match as prefix",
		input: { query: "J", contacts: sharedContacts },
		expected: { outcome: "no_match", resolvedContactId: null, candidateContactIds: [] },
	},
	{
		id: "cr-043",
		category: "contact_resolution",
		status: "active",
		description: "Edge case - possessive Mom's still matches parent",
		input: { query: "Mom's", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 2, candidateContactIds: [] },
	},
	{
		id: "cr-044",
		category: "contact_resolution",
		status: "active",
		description: "Edge case - whitespace-only query returns no match",
		input: { query: "   ", contacts: sharedContacts },
		expected: { outcome: "no_match", resolvedContactId: null, candidateContactIds: [] },
	},
	{
		id: "cr-045",
		category: "contact_resolution",
		status: "active",
		description: "Edge case - leading/trailing whitespace is trimmed",
		input: { query: "  Emily Chen  ", contacts: sharedContacts },
		expected: { outcome: "resolved", resolvedContactId: 7, candidateContactIds: [] },
	},
];
