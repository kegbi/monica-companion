import { z } from "zod/v4";

/** An important date extracted from Monica contact data (e.g. birthdate). */
export const ImportantDate = z.object({
	label: z.string(),
	date: z.string(),
	isYearUnknown: z.boolean(),
});
export type ImportantDate = z.infer<typeof ImportantDate>;

/**
 * Monica-agnostic contact projection consumed by ai-router for matching
 * and disambiguation. Produced by monica-integration from Monica API data.
 *
 * See context/product/monica-api-scope.md "ContactResolutionSummary Endpoint Mapping"
 * for the detailed field-to-endpoint mapping.
 */
export const ContactResolutionSummary = z.object({
	/** Stable Monica contact integer ID. */
	contactId: z.number().int(),

	/** Primary user-facing label (Monica's complete_name). */
	displayName: z.string(),

	/**
	 * Alternate names for matching. V1: limited to name-derived fields
	 * (nickname, first_name, last_name). Broader alias sources
	 * (user-defined aliases, family labels) are deferred to a future version.
	 */
	aliases: z.array(z.string()),

	/** Relationship labels from contact's perspective (e.g. "partner", "friend"). */
	relationshipLabels: z.array(z.string()),

	/** Important dates (V1: birthdate only). */
	importantDates: z.array(ImportantDate),

	/** Last activity date. Nullable when no activities exist. */
	lastInteractionAt: z.string().nullable(),
});
export type ContactResolutionSummary = z.infer<typeof ContactResolutionSummary>;
