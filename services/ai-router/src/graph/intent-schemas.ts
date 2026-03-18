/**
 * Zod schemas for LLM structured output (intent classification).
 *
 * These schemas define the shape that GPT structured outputs produce.
 * The LLM response is untrusted input and must always be validated
 * against these schemas after parsing.
 */

import { z } from "zod/v4";

/**
 * All V1 command types: both mutating and read-only.
 * Uses z.enum per review LOW-3 for tighter validation than z.string().
 */
const V1CommandTypeSchema = z.enum([
	"create_contact",
	"create_note",
	"create_activity",
	"update_contact_birthday",
	"update_contact_phone",
	"update_contact_email",
	"update_contact_address",
	"query_birthday",
	"query_phone",
	"query_last_note",
]);

export const IntentSchema = z.enum([
	"mutating_command",
	"read_query",
	"clarification_response",
	"greeting",
	"out_of_scope",
]);

export type Intent = z.infer<typeof IntentSchema>;

/**
 * Schema for the structured output produced by the intent classification LLM call.
 *
 * commandPayload is typed as z.record(z.string(), z.unknown()).nullable() --
 * this is intentionally loose for V1. The LLM extracts free-form fields that
 * will be validated against typed per-command schemas in a later pipeline step
 * (pending-command creation). See review MEDIUM-1.
 *
 * TODO: Validate commandPayload against typed per-command schemas during
 * pending-command creation (End-to-End Pipeline Wiring task).
 */
export const ClarificationReasonSchema = z.enum([
	"ambiguous_contact",
	"missing_fields",
	"unclear_intent",
]);

export type ClarificationReason = z.infer<typeof ClarificationReasonSchema>;

export const DisambiguationOptionSchema = z.object({
	label: z.string(),
	value: z.string(),
});

export type DisambiguationOption = z.infer<typeof DisambiguationOptionSchema>;

export const IntentClassificationResultSchema = z.object({
	intent: IntentSchema,
	detectedLanguage: z.string(),
	userFacingText: z.string(),
	commandType: V1CommandTypeSchema.nullable(),
	contactRef: z.string().nullable(),
	commandPayload: z.record(z.string(), z.unknown()).nullable(),
	confidence: z.number().min(0).max(1),
	needsClarification: z.boolean().default(false),
	clarificationReason: ClarificationReasonSchema.optional(),
	disambiguationOptions: z.array(DisambiguationOptionSchema).optional(),
});

export type IntentClassificationResult = z.infer<typeof IntentClassificationResultSchema>;
