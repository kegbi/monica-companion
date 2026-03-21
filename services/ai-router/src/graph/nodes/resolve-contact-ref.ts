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
 * Build a disambiguation option label from a candidate.
 * Format: "DisplayName -- relationshipLabel" when labels exist,
 * or just "DisplayName" when no labels.
 */
function buildDisambiguationLabel(
	candidate: ContactMatchCandidate,
	summaries: ContactResolutionSummary[],
): string {
	const summary = summaries.find((s) => s.contactId === candidate.contactId);
	const labels = summary?.relationshipLabels ?? [];
	if (labels.length > 0) {
		return `${candidate.displayName} -- ${labels[0]}`;
	}
	return candidate.displayName;
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

				// Skip conditions: no classification, no contactRef, non-applicable intents
				if (
					!intentClassification ||
					!intentClassification.contactRef ||
					intentClassification.intent === "greeting" ||
					intentClassification.intent === "out_of_scope" ||
					intentClassification.intent === "clarification_response" ||
					intentClassification.commandType === "create_contact"
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
					} catch {
						// M2 fix: on fetch failure, return {} (no state changes)
						// to preserve the LLM's original payload as graceful degradation
						console.warn("[resolve-contact-ref] failed to fetch contact summaries", {
							correlationId,
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
						updatedClassification = {
							...intentClassification,
							needsClarification: true,
							clarificationReason: "ambiguous_contact" as const,
							disambiguationOptions: options,
						};
						break;
					}
					case "no_match": {
						// M3 fix: preserve the LLM's original userFacingText
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
