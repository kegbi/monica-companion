import { z } from "zod/v4";

// ── Command Type Enums ──────────────────────────────────────────────

/**
 * Mutating command types that require the pending-command lifecycle
 * (draft -> pending_confirmation -> confirmed -> executed | expired | cancelled).
 * Only these types produce PendingCommandRecords.
 */
export const MutatingCommandType = {
	create_contact: "create_contact",
	create_note: "create_note",
	create_activity: "create_activity",
	update_contact_birthday: "update_contact_birthday",
	update_contact_phone: "update_contact_phone",
	update_contact_email: "update_contact_email",
	update_contact_address: "update_contact_address",
} as const;
export type MutatingCommandType = (typeof MutatingCommandType)[keyof typeof MutatingCommandType];

const MutatingCommandTypeSchema = z.enum([
	"create_contact",
	"create_note",
	"create_activity",
	"update_contact_birthday",
	"update_contact_phone",
	"update_contact_email",
	"update_contact_address",
]);

/**
 * Read-only command types that bypass the scheduler and stay on the
 * live request path. They never produce pending-command records.
 */
export const ReadOnlyCommandType = {
	query_birthday: "query_birthday",
	query_phone: "query_phone",
	query_last_note: "query_last_note",
} as const;
export type ReadOnlyCommandType = (typeof ReadOnlyCommandType)[keyof typeof ReadOnlyCommandType];

/**
 * Union of all command types. Use MutatingCommandType or ReadOnlyCommandType
 * when you need to distinguish the two categories.
 */
export type CommandType = MutatingCommandType | ReadOnlyCommandType;

// ── Pending Command Status ──────────────────────────────────────────

export const PendingCommandStatus = {
	draft: "draft",
	pending_confirmation: "pending_confirmation",
	confirmed: "confirmed",
	executed: "executed",
	expired: "expired",
	cancelled: "cancelled",
} as const;
export type PendingCommandStatus = (typeof PendingCommandStatus)[keyof typeof PendingCommandStatus];

const PendingCommandStatusSchema = z.enum([
	"draft",
	"pending_confirmation",
	"confirmed",
	"executed",
	"expired",
	"cancelled",
]);

// ── Mutating Command Payload Schemas ────────────────────────────────
//
// These schemas represent the AI-facing command payloads that flow through
// the pending-command lifecycle. They are intentionally separate from the
// monica-integration write request schemas (which are Monica-integration-facing).
// The two will be reconciled in Phase 4 when scheduler maps confirmed
// command payloads to monica-integration write requests.

const CreateContactPayloadSchema = z.object({
	type: z.literal("create_contact"),
	firstName: z.string().max(50),
	lastName: z.string().max(100).optional(),
	nickname: z.string().max(100).optional(),
	genderId: z.number().int(),
	birthdate: z
		.object({
			day: z.number().int(),
			month: z.number().int(),
			year: z.number().int().optional(),
		})
		.optional(),
});

const CreateNotePayloadSchema = z.object({
	type: z.literal("create_note"),
	contactId: z.number().int(),
	body: z.string().max(100000),
});

const CreateActivityPayloadSchema = z.object({
	type: z.literal("create_activity"),
	summary: z.string().max(255),
	description: z.string().max(1000000).optional(),
	happenedAt: z.string(),
	contactIds: z.array(z.number().int()),
	activityTypeId: z.number().int().nullable().optional(),
});

const UpdateContactBirthdayPayloadSchema = z.object({
	type: z.literal("update_contact_birthday"),
	contactId: z.number().int(),
	day: z.number().int(),
	month: z.number().int(),
	year: z.number().int().optional(),
});

const UpdateContactPhonePayloadSchema = z.object({
	type: z.literal("update_contact_phone"),
	contactId: z.number().int(),
	value: z.string().max(255),
	/**
	 * Monica contact_field_type_id. This is a known V1 boundary pragmatism:
	 * the AI must supply this Monica-specific ID directly. A future version
	 * should resolve type strings to IDs within monica-integration.
	 */
	contactFieldTypeId: z.number().int(),
});

const UpdateContactEmailPayloadSchema = z.object({
	type: z.literal("update_contact_email"),
	contactId: z.number().int(),
	value: z.string().max(255),
	/**
	 * Monica contact_field_type_id. Known V1 boundary pragmatism.
	 * @see UpdateContactPhonePayloadSchema.contactFieldTypeId
	 */
	contactFieldTypeId: z.number().int(),
});

const UpdateContactAddressPayloadSchema = z.object({
	type: z.literal("update_contact_address"),
	contactId: z.number().int(),
	name: z.string().optional(),
	street: z.string().nullable().optional(),
	city: z.string().nullable().optional(),
	province: z.string().nullable().optional(),
	postalCode: z.string().nullable().optional(),
	country: z.string(),
});

/** Discriminated union of all mutating command payloads. */
export const MutatingCommandPayloadSchema = z.discriminatedUnion("type", [
	CreateContactPayloadSchema,
	CreateNotePayloadSchema,
	CreateActivityPayloadSchema,
	UpdateContactBirthdayPayloadSchema,
	UpdateContactPhonePayloadSchema,
	UpdateContactEmailPayloadSchema,
	UpdateContactAddressPayloadSchema,
]);
export type MutatingCommandPayload = z.infer<typeof MutatingCommandPayloadSchema>;

// ── Read-Only Command Payload Schemas ───────────────────────────────

const QueryBirthdayPayloadSchema = z.object({
	type: z.literal("query_birthday"),
	contactId: z.number().int(),
});

const QueryPhonePayloadSchema = z.object({
	type: z.literal("query_phone"),
	contactId: z.number().int(),
});

const QueryLastNotePayloadSchema = z.object({
	type: z.literal("query_last_note"),
	contactId: z.number().int(),
});

/** Discriminated union of all read-only command payloads. */
export const ReadOnlyCommandPayloadSchema = z.discriminatedUnion("type", [
	QueryBirthdayPayloadSchema,
	QueryPhonePayloadSchema,
	QueryLastNotePayloadSchema,
]);
export type ReadOnlyCommandPayload = z.infer<typeof ReadOnlyCommandPayloadSchema>;

// ── Pending Command Record ──────────────────────────────────────────

/**
 * Schema for a pending command record as stored/returned by ai-router.
 * Only mutating commands produce pending-command records.
 * commandType is typed as MutatingCommandType (not CommandType) to enforce
 * the design invariant that read-only queries never enter the pending lifecycle.
 */
export const PendingCommandRecordSchema = z.object({
	id: z.string().uuid(),
	userId: z.string().uuid(),
	/** Must be a MutatingCommandType. Read-only queries never enter pending lifecycle. */
	commandType: MutatingCommandTypeSchema,
	payload: MutatingCommandPayloadSchema,
	status: PendingCommandStatusSchema,
	version: z.number().int().positive(),
	/**
	 * Connector-neutral opaque string identifying the originating message.
	 * Format is determined by the connector (e.g. "telegram:msg:12345").
	 * Other services must not parse or interpret this value.
	 */
	sourceMessageRef: z.string(),
	correlationId: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	expiresAt: z.string(),
	confirmedAt: z.string().nullable(),
	executedAt: z.string().nullable(),
	terminalAt: z.string().nullable(),
	executionResult: z.unknown().nullable(),
});
export type PendingCommandRecord = z.infer<typeof PendingCommandRecordSchema>;

// ── Confirmed Command Payload ───────────────────────────────────────

/**
 * Frozen snapshot sent from ai-router to scheduler when a pending command
 * is confirmed. The scheduler uses this to drive execution via monica-integration.
 */
export const ConfirmedCommandPayloadSchema = z.object({
	pendingCommandId: z.string().uuid(),
	userId: z.string().uuid(),
	commandType: MutatingCommandTypeSchema,
	payload: MutatingCommandPayloadSchema,
	/** Deterministic idempotency key: `${pendingCommandId}:v${version}` */
	idempotencyKey: z.string(),
	correlationId: z.string(),
	confirmedAt: z.string(),
	/**
	 * Optional connector routing fields. When present, scheduler uses these
	 * directly for delivery intents. When absent, scheduler resolves them
	 * from user-management (similar to how reminder-poller works).
	 */
	connectorType: z.string().min(1).optional(),
	connectorRoutingId: z.string().min(1).optional(),
});
export type ConfirmedCommandPayload = z.infer<typeof ConfirmedCommandPayloadSchema>;
