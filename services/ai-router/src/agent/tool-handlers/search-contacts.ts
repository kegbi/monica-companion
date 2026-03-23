import type { ServiceClient } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";
import type { ContactResolutionSummary, MatchReason } from "@monica-companion/types";
import { fetchContactSummaries } from "../../contact-resolution/client.js";
import { matchContacts } from "../../contact-resolution/matcher.js";

const logger = createLogger("ai-router:search-contacts-handler");

/** Maximum number of results to return to the LLM. */
const MAX_RESULTS = 10;

export interface SearchContactsParams {
	query: string;
	serviceClient: ServiceClient;
	userId: string;
	correlationId: string;
}

export interface SearchContactResult {
	contactId: number;
	displayName: string;
	aliases: string[];
	relationshipLabels: string[];
	birthdate: string | null;
	matchReason: MatchReason;
}

export type SearchContactsResponse =
	| { status: "ok"; contacts: SearchContactResult[] }
	| { status: "error"; message: string };

/**
 * Extract birthdate from importantDates array.
 * Returns the date string of the first entry with label "birthdate", or null.
 */
function extractBirthdate(summary: ContactResolutionSummary): string | null {
	const birthdateEntry = summary.importantDates.find((d) => d.label.toLowerCase() === "birthdate");
	return birthdateEntry?.date ?? null;
}

/**
 * Handle a search_contacts tool call.
 *
 * Fetches contact summaries from monica-integration, runs the deterministic
 * matcher, and returns enriched results. Returns structured errors on failure
 * so the LLM can inform the user.
 */
export async function handleSearchContacts(
	params: SearchContactsParams,
): Promise<SearchContactsResponse> {
	const { query, serviceClient, userId, correlationId } = params;

	let summaries: ContactResolutionSummary[];
	try {
		summaries = await fetchContactSummaries(serviceClient, userId, correlationId);
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		logger.warn("Failed to fetch contact summaries for search", {
			correlationId,
			userId,
			error: errMsg,
		});
		return {
			status: "error",
			message: "Unable to complete contact search. Please try again later.",
		};
	}

	const candidates = matchContacts(query, summaries);

	// Build a lookup map for joining matched results back to original summaries
	const summaryMap = new Map(summaries.map((s) => [s.contactId, s]));

	const contacts: SearchContactResult[] = candidates.slice(0, MAX_RESULTS).map((candidate) => {
		const summary = summaryMap.get(candidate.contactId);
		return {
			contactId: candidate.contactId,
			displayName: candidate.displayName,
			aliases: summary?.aliases ?? [],
			relationshipLabels: summary?.relationshipLabels ?? [],
			birthdate: summary ? extractBirthdate(summary) : null,
			matchReason: candidate.matchReason,
		};
	});

	logger.info("Contact search completed", {
		correlationId,
		userId,
		matchCount: contacts.length,
		totalCandidates: candidates.length,
	});

	return { status: "ok", contacts };
}
