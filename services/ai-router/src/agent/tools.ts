import type { ChatCompletionTool } from "openai/resources/chat/completions";

/**
 * Tool names that perform read-only operations.
 * These bypass the scheduler and return results directly.
 */
export const READ_ONLY_TOOLS = new Set([
	"search_contacts",
	"query_birthday",
	"query_phone",
	"query_last_note",
]);

/**
 * Tool names that perform mutating operations.
 * These require confirmation before execution (Stage 2).
 */
export const MUTATING_TOOLS = new Set([
	"create_note",
	"create_contact",
	"create_activity",
	"update_contact_birthday",
	"update_contact_phone",
	"update_contact_email",
	"update_contact_address",
]);

/**
 * All 11 tool definitions in OpenAI function-calling format.
 * Tool handlers are implemented in Stage 4; during Stage 1 all calls
 * receive a stub "not yet implemented" result.
 */
export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
	// --- Read-only tools ---
	{
		type: "function",
		function: {
			name: "search_contacts",
			description:
				"Search for contacts by name or other criteria. Returns a list of matching contacts with their IDs and basic info.",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description: "The search query (name, nickname, or other identifier)",
					},
				},
				required: ["query"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "query_birthday",
			description: "Look up a contact's birthday by their contact ID.",
			parameters: {
				type: "object",
				properties: {
					contact_id: {
						type: "number",
						description: "The Monica contact ID",
					},
				},
				required: ["contact_id"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "query_phone",
			description: "Look up a contact's phone number by their contact ID.",
			parameters: {
				type: "object",
				properties: {
					contact_id: {
						type: "number",
						description: "The Monica contact ID",
					},
				},
				required: ["contact_id"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "query_last_note",
			description: "Look up the most recent note for a contact by their contact ID.",
			parameters: {
				type: "object",
				properties: {
					contact_id: {
						type: "number",
						description: "The Monica contact ID",
					},
				},
				required: ["contact_id"],
			},
		},
	},

	// --- Mutating tools ---
	{
		type: "function",
		function: {
			name: "create_note",
			description:
				"Create a note for a contact. The note body should be the user's message or a summary of what they want to record.",
			parameters: {
				type: "object",
				properties: {
					contact_id: {
						type: "number",
						description: "The Monica contact ID",
					},
					body: {
						type: "string",
						description: "The note content",
					},
				},
				required: ["contact_id", "body"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "create_contact",
			description: "Create a new contact with basic information.",
			parameters: {
				type: "object",
				properties: {
					first_name: {
						type: "string",
						description: "The contact's first name",
					},
					last_name: {
						type: "string",
						description: "The contact's last name (optional)",
					},
					gender_id: {
						type: "number",
						description: "Gender ID (1=Male, 2=Female, 3=Other). Default 3 if unknown.",
					},
				},
				required: ["first_name"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "create_activity",
			description: "Log an activity with one or more contacts.",
			parameters: {
				type: "object",
				properties: {
					contact_ids: {
						type: "array",
						items: { type: "number" },
						description: "Array of Monica contact IDs involved in the activity",
					},
					description: {
						type: "string",
						description: "Description of the activity",
					},
					activity_type: {
						type: "string",
						description: "Type of activity (e.g., 'lunch', 'call', 'meeting')",
					},
					date: {
						type: "string",
						description: "Date of the activity in YYYY-MM-DD format",
					},
				},
				required: ["contact_ids", "description"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "update_contact_birthday",
			description: "Set or update a contact's birthday.",
			parameters: {
				type: "object",
				properties: {
					contact_id: {
						type: "number",
						description: "The Monica contact ID",
					},
					date: {
						type: "string",
						description: "Birthday in YYYY-MM-DD format",
					},
					is_age_based: {
						type: "boolean",
						description: "If true, only the year matters (age-based birthday)",
					},
				},
				required: ["contact_id", "date"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "update_contact_phone",
			description: "Set or update a contact's phone number.",
			parameters: {
				type: "object",
				properties: {
					contact_id: {
						type: "number",
						description: "The Monica contact ID",
					},
					phone_number: {
						type: "string",
						description: "The phone number",
					},
				},
				required: ["contact_id", "phone_number"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "update_contact_email",
			description: "Set or update a contact's email address.",
			parameters: {
				type: "object",
				properties: {
					contact_id: {
						type: "number",
						description: "The Monica contact ID",
					},
					email: {
						type: "string",
						description: "The email address",
					},
				},
				required: ["contact_id", "email"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "update_contact_address",
			description: "Set or update a contact's address.",
			parameters: {
				type: "object",
				properties: {
					contact_id: {
						type: "number",
						description: "The Monica contact ID",
					},
					street: {
						type: "string",
						description: "Street address",
					},
					city: {
						type: "string",
						description: "City",
					},
					province: {
						type: "string",
						description: "State/Province",
					},
					postal_code: {
						type: "string",
						description: "Postal/ZIP code",
					},
					country: {
						type: "string",
						description: "Country (ISO 3166-1 alpha-2 code preferred)",
					},
				},
				required: ["contact_id"],
			},
		},
	},
];
