import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod/v4";

/**
 * Tool names that perform read-only operations.
 * These bypass the scheduler and return results directly.
 */
export const READ_ONLY_TOOLS = new Set([
	"search_contacts",
	"query_birthday",
	"query_phone",
	"query_last_note",
	"query_reminders",
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
	"update_contact_nickname",
	"delete_contact",
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
				"Search for contacts by name, nickname, or relationship term (e.g. 'mom', 'brother'). Returns matching contacts with contactId, displayName, aliases, relationship labels, birthdate, and match reason. Call this before any tool that requires a contactId.",
			parameters: {
				type: "object",
				properties: {
					query: {
						type: "string",
						description:
							"The search query: a name, nickname, or relationship term (e.g. 'Jane', 'mom', 'brother')",
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
	{
		type: "function",
		function: {
			name: "query_reminders",
			description:
				"Get upcoming reminders and notifications for a date range. Returns reminder titles, descriptions, associated contact names, and planned dates. Use days=1 for today, days=7 for the next week, days=30 for the next month, etc.",
			parameters: {
				type: "object",
				properties: {
					days: {
						type: "number",
						description:
							"Number of days to look ahead (including today). Default 1 (today only). Max 90.",
					},
				},
				required: [],
			},
		},
	},

	// --- Mutating tools ---
	{
		type: "function",
		function: {
			name: "create_note",
			description:
				"Create a note for a contact. The body parameter must contain the actual note text provided by the user. If the user did not specify what the note should say, do NOT call this tool — ask the user for the note content first.",
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
			description:
				"Create a new contact. Include birthday_date when the user provides a date of birth.",
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
					nickname: {
						type: "string",
						description: "The contact's nickname (optional)",
					},
					gender_id: {
						type: "number",
						description: "Gender ID (1=Male, 2=Female, 3=Other). Default 3 if unknown.",
					},
					birthday_date: {
						type: "string",
						description: "Birthday in YYYY-MM-DD format (optional)",
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
	{
		type: "function",
		function: {
			name: "update_contact_nickname",
			description:
				"Set, update, or remove a contact's nickname. Pass an empty string to remove an existing nickname.",
			parameters: {
				type: "object",
				properties: {
					contact_id: {
						type: "number",
						description: "The Monica contact ID",
					},
					nickname: {
						type: "string",
						description:
							"The new nickname for the contact. Pass an empty string to remove the nickname.",
					},
				},
				required: ["contact_id", "nickname"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "delete_contact",
			description:
				"Permanently delete a contact and all associated data (notes, activities, reminders). This action is irreversible. Only call this when the user explicitly asks to delete a contact.",
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
];

// --- Zod argument schemas for read-only tools that require validation ---

export const SearchContactsArgsSchema = z.object({
	query: z.string().min(1),
});

export const QueryBirthdayArgsSchema = z.object({
	contact_id: z.number().int().positive(),
});

export const QueryPhoneArgsSchema = z.object({
	contact_id: z.number().int().positive(),
});

export const QueryLastNoteArgsSchema = z.object({
	contact_id: z.number().int().positive(),
});

export const QueryRemindersArgsSchema = z.object({
	days: z.number().int().min(1).max(90).optional(),
});

// --- Zod argument schemas for mutating tools ---

const CreateNoteArgsSchema = z.object({
	contact_id: z.number().int(),
	body: z.string().min(1),
});

const CreateContactArgsSchema = z.object({
	first_name: z.string().min(1),
	last_name: z.string().optional(),
	nickname: z.string().optional(),
	gender_id: z.number().int().optional(),
	birthday_date: z.string().optional(),
});

const CreateActivityArgsSchema = z.object({
	contact_ids: z.array(z.number().int()).min(1),
	description: z.string().min(1).max(255),
	activity_type: z.string().optional(),
	date: z.string().optional(),
});

const UpdateContactBirthdayArgsSchema = z.object({
	contact_id: z.number().int(),
	date: z.string().min(1),
	is_age_based: z.boolean().optional(),
});

const UpdateContactPhoneArgsSchema = z.object({
	contact_id: z.number().int(),
	phone_number: z.string().min(1),
});

const UpdateContactEmailArgsSchema = z.object({
	contact_id: z.number().int(),
	email: z.string().min(1),
});

const UpdateContactAddressArgsSchema = z.object({
	contact_id: z.number().int(),
	street: z.string().optional(),
	city: z.string().optional(),
	province: z.string().optional(),
	postal_code: z.string().optional(),
	country: z.string().optional(),
});

const UpdateContactNicknameArgsSchema = z.object({
	contact_id: z.number().int().positive(),
	nickname: z.string(),
});

const DeleteContactArgsSchema = z.object({
	contact_id: z.number().int().positive(),
});

/**
 * Map of mutating tool names to their Zod argument schemas.
 * Used to validate tool arguments before serialization into pendingToolCall.
 */
export const TOOL_ARG_SCHEMAS: Record<string, z.ZodType> = {
	search_contacts: SearchContactsArgsSchema,
	query_birthday: QueryBirthdayArgsSchema,
	query_phone: QueryPhoneArgsSchema,
	query_last_note: QueryLastNoteArgsSchema,
	create_note: CreateNoteArgsSchema,
	create_contact: CreateContactArgsSchema,
	create_activity: CreateActivityArgsSchema,
	update_contact_birthday: UpdateContactBirthdayArgsSchema,
	update_contact_phone: UpdateContactPhoneArgsSchema,
	update_contact_email: UpdateContactEmailArgsSchema,
	update_contact_address: UpdateContactAddressArgsSchema,
	update_contact_nickname: UpdateContactNicknameArgsSchema,
	delete_contact: DeleteContactArgsSchema,
	query_reminders: QueryRemindersArgsSchema,
};

/**
 * Resolve a human-readable contact label from args.
 * Uses contactName when available (extracted from prior search_contacts results),
 * falls back to the numeric contact_id.
 */
function contactLabel(args: Record<string, unknown>): string {
	if (typeof args.contactName === "string" && args.contactName.length > 0) {
		return args.contactName;
	}
	return `contact ${args.contact_id}`;
}

function truncate(text: string, maxLen: number): string {
	return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

/**
 * Generate a human-readable description of a tool action for the confirmation prompt.
 * Avoids including sensitive data — uses tool name and key identifiers only.
 *
 * When a `contactName` key is present in `args` it is used instead of the raw
 * numeric `contact_id`.  The caller is responsible for injecting `contactName`
 * by looking up the most recent `search_contacts` tool result in the
 * conversation history.
 */
export function generateActionDescription(toolName: string, args: Record<string, unknown>): string {
	switch (toolName) {
		case "create_note":
			return `Create a note for ${contactLabel(args)}: "${truncate(String(args.body ?? ""), 200)}"`;
		case "create_contact": {
			const name = [args.first_name, args.last_name].filter(Boolean).join(" ");
			const nick =
				typeof args.nickname === "string" && args.nickname.length > 0
					? ` (nickname: "${args.nickname}")`
					: "";
			const bday =
				typeof args.birthday_date === "string" && args.birthday_date.length > 0
					? `, birthday ${args.birthday_date}`
					: "";
			return `Create a new contact: ${name}${nick}${bday}`;
		}
		case "create_activity": {
			const ids = Array.isArray(args.contact_ids) ? args.contact_ids.join(", ") : "unknown";
			const desc = typeof args.description === "string" ? args.description : "";
			return `Log an activity with contact(s) ${ids}: "${truncate(desc, 200)}"`;
		}
		case "update_contact_birthday":
			return `Update birthday for ${contactLabel(args)} to ${args.date}`;
		case "update_contact_phone":
			return `Update phone number for ${contactLabel(args)}`;
		case "update_contact_email":
			return `Update email for ${contactLabel(args)}`;
		case "update_contact_address":
			return `Update address for ${contactLabel(args)}`;
		case "update_contact_nickname": {
			const nick =
				typeof args.nickname === "string" && args.nickname.length > 0
					? `"${args.nickname}"`
					: "(remove)";
			return `Update nickname for ${contactLabel(args)} to ${nick}`;
		}
		case "delete_contact":
			return `Permanently delete ${contactLabel(args)} and all associated data`;
		default:
			return `Execute ${toolName}`;
	}
}
