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
 * Progressive narrowing:
 * When ambiguous candidates exceed NARROWING_BUTTON_THRESHOLD (5), asks a
 * clarifying question instead of presenting buttons. Subsequent clarification
 * responses re-run matching against the narrowed pool. Narrowing continues
 * for up to MAX_NARROWING_ROUNDS rounds, then forces top 5 as buttons.
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
	MAX_NARROWING_ROUNDS,
	MINIMUM_MATCH_THRESHOLD,
	NARROWING_BUTTON_THRESHOLD,
	RESOLVED_THRESHOLD,
} from "../../contact-resolution/resolver.js";
import type { IntentClassificationResult } from "../intent-schemas.js";
import type { ConversationAnnotation, NarrowingContext } from "../state.js";

const tracer = trace.getTracer("ai-router");

type State = typeof ConversationAnnotation.State;
type Update = typeof ConversationAnnotation.Update;

export interface ResolveContactRefDeps {
	monicaIntegrationClient: ServiceClient;
}

/**
 * Strip the parenthetical portion of a display name.
 * Monica formats complete_name as "John Doe (Johnny)" when a nickname is set.
 * "John Doe (Johnny)" -> "John Doe"
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
 * Extract clarification text from the current state.
 * Fallback chain:
 * 1. intentClassification.contactRef if non-null/non-empty
 * 2. inboundEvent.text for text_message
 * 3. inboundEvent.transcribedText for voice_message
 * 4. null if none available
 */
function extractClarificationText(state: State): string | null {
	const { intentClassification, inboundEvent } = state;

	// 1. contactRef from LLM
	if (intentClassification?.contactRef) {
		return intentClassification.contactRef;
	}

	// 2. text from text_message
	if (inboundEvent.type === "text_message" && inboundEvent.text) {
		return inboundEvent.text;
	}

	// 3. transcribedText from voice_message
	if (inboundEvent.type === "voice_message" && inboundEvent.transcribedText) {
		return inboundEvent.transcribedText;
	}

	return null;
}

/**
 * Build disambiguation options from candidates, limited to MAX_DISAMBIGUATION_CANDIDATES.
 */
function buildDisambiguationOptions(
	candidates: ContactMatchCandidate[],
	summaries: ContactResolutionSummary[],
) {
	return candidates.slice(0, MAX_DISAMBIGUATION_CANDIDATES).map((c) => ({
		label: buildDisambiguationLabel(c, summaries),
		value: String(c.contactId),
	}));
}

/**
 * Handle a subsequent narrowing round.
 * Filters the pool by the clarification text and branches on result count.
 */
function handleNarrowingRound(
	state: State,
	narrowingContext: NarrowingContext,
	clarificationText: string,
	summaries: ContactResolutionSummary[],
	intentClassification: IntentClassificationResult,
	correlationId: string,
): Update {
	// Filter summaries to the current pool
	const poolIds = new Set(narrowingContext.narrowingCandidateIds);
	const poolSummaries = summaries.filter((s) => poolIds.has(s.contactId));

	// Run matchContacts against the filtered pool
	const candidates = matchContacts(clarificationText, poolSummaries);

	if (candidates.length === 0) {
		// No matches in pool: fallback
		logger.info("Narrowing pool reached 0 matches, falling back to no_match", {
			correlationId,
			originalContactRef: narrowingContext.originalContactRef,
			clarificationText,
		});
		return {
			contactResolution: {
				outcome: "no_match",
				resolved: null,
				candidates: [],
				query: narrowingContext.originalContactRef,
			},
			contactSummariesCache: summaries,
			intentClassification: {
				...intentClassification,
				needsClarification: true,
				clarificationReason: "ambiguous_contact" as const,
			},
			narrowingContext: null,
		};
	}

	if (candidates.length === 1) {
		// Single match: resolved
		const resolvedSummary = summaries.find((s) => s.contactId === candidates[0].contactId);
		logger.info("Narrowing resolved to single contact", {
			correlationId,
			contactId: candidates[0].contactId,
			originalContactRef: narrowingContext.originalContactRef,
		});
		return {
			contactResolution: {
				outcome: "resolved",
				resolved: resolvedSummary ?? null,
				candidates: [],
				query: narrowingContext.originalContactRef,
			},
			contactSummariesCache: summaries,
			intentClassification: {
				...intentClassification,
				needsClarification: false,
				commandPayload: {
					...(intentClassification.commandPayload ?? {}),
					contactId: candidates[0].contactId,
				},
			},
			narrowingContext: null,
		};
	}

	if (candidates.length <= NARROWING_BUTTON_THRESHOLD) {
		// 2-5 matches: present buttons
		const options = buildDisambiguationOptions(candidates, summaries);
		logger.info("Narrowing reduced pool to button-presentable size", {
			correlationId,
			candidateCount: candidates.length,
			originalContactRef: narrowingContext.originalContactRef,
		});
		return {
			contactResolution: {
				outcome: "ambiguous",
				resolved: null,
				candidates: candidates.slice(0, MAX_DISAMBIGUATION_CANDIDATES),
				query: narrowingContext.originalContactRef,
			},
			contactSummariesCache: summaries,
			intentClassification: {
				...intentClassification,
				needsClarification: true,
				clarificationReason: "ambiguous_contact" as const,
				disambiguationOptions: options,
			},
			narrowingContext: null,
		};
	}

	const nextRound = narrowingContext.round + 1;

	if (nextRound >= MAX_NARROWING_ROUNDS) {
		// Round cap reached: force top 5 as buttons
		const options = buildDisambiguationOptions(candidates, summaries);
		logger.info("Narrowing round cap reached, forcing button selection", {
			correlationId,
			candidateCount: candidates.length,
			round: nextRound,
			originalContactRef: narrowingContext.originalContactRef,
		});
		return {
			contactResolution: {
				outcome: "ambiguous",
				resolved: null,
				candidates: candidates.slice(0, MAX_DISAMBIGUATION_CANDIDATES),
				query: narrowingContext.originalContactRef,
			},
			contactSummariesCache: summaries,
			intentClassification: {
				...intentClassification,
				needsClarification: true,
				clarificationReason: "ambiguous_contact" as const,
				disambiguationOptions: options,
			},
			narrowingContext: null,
		};
	}

	// Still >5 and under cap: continue narrowing
	const newNarrowingContext: NarrowingContext = {
		originalContactRef: narrowingContext.originalContactRef,
		clarifications: [...narrowingContext.clarifications, clarificationText],
		round: nextRound,
		narrowingCandidateIds: candidates.map((c) => c.contactId),
	};

	logger.info("Narrowing continuing with reduced pool", {
		correlationId,
		poolSize: candidates.length,
		round: nextRound,
		originalContactRef: narrowingContext.originalContactRef,
	});

	return {
		contactSummariesCache: summaries,
		intentClassification: {
			...intentClassification,
			needsClarification: true,
			clarificationReason: "ambiguous_contact" as const,
			userFacingText: `I still found ${candidates.length} contacts. Can you provide more details to help narrow it down?`,
		},
		narrowingContext: newNarrowingContext,
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

				// --- MEDIUM-2 fix: Check narrowing context FIRST, before skip guards ---
				// When narrowingContext is present, the LLM may not set contactRef,
				// so the existing skip guard would incorrectly return early.
				if (state.narrowingContext && intentClassification) {
					// 5c: Abandon narrowing if intent is not clarification_response
					if (intentClassification.intent !== "clarification_response") {
						logger.info("Abandoning narrowing due to non-clarification intent", {
							correlationId,
							intent: intentClassification.intent,
							originalContactRef: state.narrowingContext.originalContactRef,
						});
						// Fall through to normal resolution with narrowingContext cleared
						return await resolveNormal(deps, { ...state, narrowingContext: null }, span, true);
					}

					// 5b: Subsequent narrowing round
					const clarificationText = extractClarificationText(state);
					if (!clarificationText) {
						// Cannot extract clarification: abandon narrowing
						logger.warn("Cannot extract clarification text during narrowing, abandoning", {
							correlationId,
						});
						return { narrowingContext: null };
					}

					// Fetch or use cached summaries
					const summaries = await fetchSummaries(deps, state, span);
					if (!summaries) return {};

					span.setAttribute("ai-router.resolution_outcome", "narrowing_round");
					return handleNarrowingRound(
						state,
						state.narrowingContext,
						clarificationText,
						summaries,
						intentClassification,
						correlationId,
					);
				}

				// --- Normal resolution path ---
				return await resolveNormal(deps, state, span, false);
			} finally {
				span.end();
			}
		});
	};
}

/**
 * Fetch contact summaries from cache or remote.
 * Returns null on failure (caller should return {} for graceful degradation).
 */
async function fetchSummaries(
	deps: ResolveContactRefDeps,
	state: State,
	span: { setAttribute: (key: string, value: string) => void },
): Promise<ContactResolutionSummary[] | null> {
	if (state.contactSummariesCache) {
		return state.contactSummariesCache;
	}

	try {
		return await fetchContactSummaries(
			deps.monicaIntegrationClient,
			state.userId,
			state.correlationId,
		);
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		logger.error("Failed to fetch contact summaries from monica-integration", {
			userId: state.userId,
			correlationId: state.correlationId,
			error: errMsg,
		});
		span.setAttribute("ai-router.resolution_outcome", "fetch_error");
		return null;
	}
}

/**
 * Normal (non-narrowing) contact resolution path.
 * Used for initial resolution and when narrowing is abandoned.
 */
async function resolveNormal(
	deps: ResolveContactRefDeps,
	state: State,
	span: { setAttribute: (key: string, value: string) => void },
	abandoningNarrowing: boolean,
): Promise<Update> {
	const { intentClassification, correlationId } = state;

	// Skip conditions: no classification, no contactRef, non-applicable intents,
	// or callback_action events (select/confirm/cancel/edit callbacks already
	// carry the contactId or don't need resolution -- re-running resolution
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
		const result: Update = {};
		if (abandoningNarrowing) {
			result.narrowingContext = null;
		}
		return result;
	}

	const contactRef = intentClassification.contactRef;

	// Fetch or use cached summaries
	const summaries = await fetchSummaries(deps, state, span);
	if (!summaries) return {};

	// Run deterministic matching
	const candidates = matchContacts(contactRef, summaries);
	const resolution = resolveFromCandidates(contactRef, candidates, summaries);

	// Build updated intent classification (spread, no mutation)
	let updatedClassification: IntentClassificationResult;
	let narrowingContextUpdate: NarrowingContext | null | undefined;

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
			// 5a: Check if candidates exceed narrowing threshold
			// Use ALL candidates (not just those in resolution.candidates which is capped at 5)
			if (candidates.length > NARROWING_BUTTON_THRESHOLD) {
				// Trigger progressive narrowing
				logger.info("Triggering progressive narrowing", {
					correlationId,
					contactRef,
					candidateCount: candidates.length,
				});

				narrowingContextUpdate = {
					originalContactRef: contactRef,
					clarifications: [],
					round: 0,
					narrowingCandidateIds: candidates.map((c) => c.contactId),
				};

				updatedClassification = {
					...intentClassification,
					needsClarification: true,
					clarificationReason: "ambiguous_contact" as const,
					userFacingText: `I found ${candidates.length} contacts matching "${contactRef}". Can you tell me their name to help narrow it down?`,
				};
			} else {
				// Normal disambiguation with buttons
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
			}
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

	const result: Update = {
		contactResolution: resolution,
		contactSummariesCache: summaries,
		intentClassification: updatedClassification,
	};

	if (narrowingContextUpdate !== undefined) {
		result.narrowingContext = narrowingContextUpdate;
	}

	if (abandoningNarrowing && narrowingContextUpdate === undefined) {
		result.narrowingContext = null;
	}

	return result;
}
