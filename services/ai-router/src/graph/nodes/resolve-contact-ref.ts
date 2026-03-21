/**
 * resolveContactRef graph node.
 *
 * Runs between classifyIntent and executeAction. When the intent classification
 * contains a non-null contactRef for a mutating_command or read_query (except
 * create_contact), resolves it against real Monica contact data via
 * monica-integration.
 *
 * Resolution outcomes:
 * - resolved: injects contactId into commandPayload
 * - ambiguous: sets needsClarification with real disambiguation options
 * - no_match: sets needsClarification, preserves LLM's userFacingText
 *
 * On fetch failure, returns {} (no state changes) for graceful degradation.
 */

import type { ServiceClient } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";

const logger = createLogger("ai-router:resolve-contact-ref");

import type {
	ContactMatchCandidate,
	ContactResolutionResult,
	ContactResolutionSummary,
} from "@monica-companion/types";
import { trace } from "@opentelemetry/api";
import { fetchContactSummaries } from "../../contact-resolution/client.js";
import { matchContacts } from "../../contact-resolution/matcher.js";
import {
	AMBIGUITY_GAP_THRESHOLD,
	MAX_DISAMBIGUATION_CANDIDATES,
	MINIMUM_MATCH_THRESHOLD,
	RESOLVED_THRESHOLD,
} from "../../contact-resolution/resolver.js";
import type { IntentClassificationResult } from "../intent-schemas.js";
import type { ConversationAnnotation } from "../state.js";

const tracer = trace.getTracer("ai-router");

type State = typeof ConversationAnnotation.State;
type Update = typeof ConversationAnnotation.Update;

export interface ResolveContactRefDeps {
	monicaIntegrationClient: ServiceClient;
}

/**
 * Strip the parenthetical portion of a display name.
 * Monica formats complete_name as "John Doe (Johnny)" when a nickname is set.
 * "John Doe (Johnny)" → "John Doe"
 */
function stripParenthetical(displayName: string): string {
	return displayName.replace(/\s*\(.*?\)\s*$/, "").trim();
}

const SHORT_MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/**
 * Format an ImportantDate birthdate for display on a disambiguation button.
 * Returns "b. 15 Mar 1965" or "b. 15 Mar" when year is unknown.
 */
function formatBirthdate(
	importantDates: { label: string; date: string; isYearUnknown: boolean }[],
): string | null {
	const bd = importantDates.find((d) => d.label === "birthdate");
	if (!bd) return null;

	const parts = bd.date.split("-");
	if (parts.length < 3) return null;

	const month = Number.parseInt(parts[1], 10);
	const day = Number.parseInt(parts[2], 10);
	if (Number.isNaN(month) || Number.isNaN(day) || month < 1 || month > 12) return null;

	const monthName = SHORT_MONTHS[month - 1];
	return bd.isYearUnknown ? `b. ${day} ${monthName}` : `b. ${day} ${monthName} ${parts[0]}`;
}

/**
 * Build a disambiguation option label from a candidate.
 * Format: "BaseName (nickname), b. DD Mon YYYY"
 *
 * Shows the full name, an informative nickname if available, and birthdate
 * when present. Relationship labels are omitted because they are often
 * confusing or redundant in button context (e.g. "date" looks like a calendar date).
 *
 * Uses the stripped display name (without Monica's built-in nickname parenthetical)
 * as the base to avoid double parentheticals like "Elena Yuryevna (Mama) (parent)".
 */
function buildDisambiguationLabel(
	candidate: ContactMatchCandidate,
	summaries: ContactResolutionSummary[],
): string {
	const summary = summaries.find((s) => s.contactId === candidate.contactId);
	const baseName = stripParenthetical(candidate.displayName);
	const baseLower = baseName.toLowerCase();

	// Add nickname if it provides new info (not already a substring of the base name).
	const aliases = summary?.aliases ?? [];
	const nickname = aliases.find(
		(a) => !baseLower.includes(a.toLowerCase()) && a.toLowerCase() !== baseLower,
	);

	let label = nickname ? `${baseName} (${nickname})` : baseName;

	// Append birthdate when available
	const dob = formatBirthdate(summary?.importantDates ?? []);
	if (dob) {
		label = `${label}, ${dob}`;
	}

	return label;
}

/**
 * Resolve candidates into a ContactResolutionResult using the same
 * threshold logic as the standalone resolver.
 */
function resolveFromCandidates(
	contactRef: string,
	candidates: ContactMatchCandidate[],
	summaries: ContactResolutionSummary[],
): ContactResolutionResult {
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

/**
 * Creates a resolveContactRef node function that uses the given deps.
 * Dependencies are injected to allow mocking in tests.
 */
export function createResolveContactRefNode(deps: ResolveContactRefDeps) {
	return async function resolveContactRefNode(state: State): Promise<Update> {
		return tracer.startActiveSpan("ai-router.graph.resolve_contact_ref", async (span) => {
			try {
				const { intentClassification, userId, correlationId } = state;

				// Skip conditions: no classification, no contactRef, non-applicable intents,
				// or callback_action events (select/confirm/cancel/edit callbacks already
				// carry the contactId or don't need resolution — re-running resolution
				// on the LLM's synthetic callback message causes spurious re-disambiguation).
				if (
					!intentClassification ||
					!intentClassification.contactRef ||
					intentClassification.intent === "greeting" ||
					intentClassification.intent === "out_of_scope" ||
					intentClassification.commandType === "create_contact" ||
					state.inboundEvent.type === "callback_action"
				) {
					span.setAttribute("ai-router.resolution_outcome", "skipped");
					return {};
				}

				const contactRef = intentClassification.contactRef;

				// Fetch or use cached summaries
				let summaries: ContactResolutionSummary[];
				if (state.contactSummariesCache) {
					summaries = state.contactSummariesCache;
				} else {
					try {
						summaries = await fetchContactSummaries(
							deps.monicaIntegrationClient,
							userId,
							correlationId,
						);
					} catch (err) {
						const errMsg = err instanceof Error ? err.message : String(err);
						logger.error("Failed to fetch contact summaries from monica-integration", {
							userId,
							correlationId,
							error: errMsg,
						});
						span.setAttribute("ai-router.resolution_outcome", "fetch_error");
						return {};
					}
				}

				// Run deterministic matching
				const candidates = matchContacts(contactRef, summaries);
				const resolution = resolveFromCandidates(contactRef, candidates, summaries);

				// Build updated intent classification (spread, no mutation)
				let updatedClassification: IntentClassificationResult;

				switch (resolution.outcome) {
					case "resolved": {
						logger.info("Contact resolved", {
							correlationId,
							contactRef,
							contactId: resolution.resolved!.contactId,
							displayName: resolution.resolved!.displayName,
						});
						updatedClassification = {
							...intentClassification,
							needsClarification: false,
							commandPayload: {
								...(intentClassification.commandPayload ?? {}),
								contactId: resolution.resolved!.contactId,
							},
						};
						break;
					}
					case "ambiguous": {
						const options = resolution.candidates.map((c) => ({
							label: buildDisambiguationLabel(c, summaries),
							value: String(c.contactId),
						}));
						logger.info("Contact resolution ambiguous, presenting disambiguation", {
							correlationId,
							contactRef,
							candidateCount: resolution.candidates.length,
							options: options.map((o) => ({ label: o.label, value: o.value })),
						});
						updatedClassification = {
							...intentClassification,
							needsClarification: true,
							clarificationReason: "ambiguous_contact" as const,
							disambiguationOptions: options,
						};
						break;
					}
					case "no_match": {
						logger.info("Contact resolution found no match", {
							correlationId,
							contactRef,
						});
						updatedClassification = {
							...intentClassification,
							needsClarification: true,
							clarificationReason: "ambiguous_contact" as const,
						};
						break;
					}
				}

				span.setAttribute("ai-router.resolution_outcome", resolution.outcome);

				return {
					contactResolution: resolution,
					contactSummariesCache: summaries,
					intentClassification: updatedClassification,
				};
			} finally {
				span.end();
			}
		});
	};
}
