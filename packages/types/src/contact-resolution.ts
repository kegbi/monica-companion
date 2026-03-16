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

/** Possible reasons a candidate matched a contact reference query. */
export const MatchReason = z.enum([
	"exact_display_name",
	"exact_first_name",
	"alias_match",
	"relationship_label_match",
	"partial_match",
]);
export type MatchReason = z.infer<typeof MatchReason>;

/** A scored contact candidate returned by the matching algorithm. */
export const ContactMatchCandidate = z.object({
	contactId: z.number().int(),
	displayName: z.string(),
	score: z.number().min(0).max(1),
	matchReason: MatchReason,
});
export type ContactMatchCandidate = z.infer<typeof ContactMatchCandidate>;

/** Possible outcomes of the contact resolution process. */
export const ResolutionOutcome = z.enum(["resolved", "ambiguous", "no_match"]);
export type ResolutionOutcome = z.infer<typeof ResolutionOutcome>;

/** Result of resolving a natural-language contact reference to Monica contacts. */
export const ContactResolutionResult = z.object({
	outcome: ResolutionOutcome,
	resolved: ContactResolutionSummary.nullable(),
	candidates: z.array(ContactMatchCandidate),
	query: z.string(),
});
export type ContactResolutionResult = z.infer<typeof ContactResolutionResult>;

/** Request to resolve a natural-language contact reference. */
export const ContactResolutionRequest = z.object({
	contactRef: z.string().min(1).max(500),
	correlationId: z.string().min(1),
});
export type ContactResolutionRequest = z.infer<typeof ContactResolutionRequest>;
