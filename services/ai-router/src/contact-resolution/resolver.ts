import type { ServiceClient } from "@monica-companion/auth";
import type { ContactResolutionResult } from "@monica-companion/types";
import { fetchContactSummaries } from "./client.js";
import { matchContacts } from "./matcher.js";

/** Auto-select threshold: top candidate score must be at least this. */
export const RESOLVED_THRESHOLD = 0.9;

/** Minimum gap between top and second candidate for auto-resolve. */
export const AMBIGUITY_GAP_THRESHOLD = 0.1;

/** Minimum score for a candidate to be considered a match at all. */
export const MINIMUM_MATCH_THRESHOLD = 0.6;

/** Maximum number of disambiguation candidates to return. */
export const MAX_DISAMBIGUATION_CANDIDATES = 5;

/**
 * Resolve a natural-language contact reference to a ContactResolutionResult.
 *
 * Composes the HTTP client (fetches summaries from monica-integration)
 * and the deterministic matcher (scores and ranks candidates) to produce
 * a resolution outcome: resolved, ambiguous, or no_match.
 */
export async function resolveContact(
	serviceClient: ServiceClient,
	userId: string,
	contactRef: string,
	correlationId: string,
): Promise<ContactResolutionResult> {
	const summaries = await fetchContactSummaries(serviceClient, userId, correlationId);
	const candidates = matchContacts(contactRef, summaries);

	if (candidates.length === 0) {
		return {
			outcome: "no_match",
			resolved: null,
			candidates: [],
			query: contactRef,
		};
	}

	const topScore = candidates[0].score;
	const secondScore = candidates.length > 1 ? candidates[1].score : 0;

	// Resolved: top candidate is high-confidence and clearly ahead
	if (topScore >= RESOLVED_THRESHOLD && topScore - secondScore >= AMBIGUITY_GAP_THRESHOLD) {
		// Find the full summary for the resolved contact
		const resolvedSummary = summaries.find((s) => s.contactId === candidates[0].contactId);

		return {
			outcome: "resolved",
			resolved: resolvedSummary ?? null,
			candidates: [],
			query: contactRef,
		};
	}

	// Ambiguous: at least one candidate above minimum threshold
	if (topScore >= MINIMUM_MATCH_THRESHOLD) {
		return {
			outcome: "ambiguous",
			resolved: null,
			candidates: candidates.slice(0, MAX_DISAMBIGUATION_CANDIDATES),
			query: contactRef,
		};
	}

	// No match: nothing above the minimum threshold
	return {
		outcome: "no_match",
		resolved: null,
		candidates: [],
		query: contactRef,
	};
}
