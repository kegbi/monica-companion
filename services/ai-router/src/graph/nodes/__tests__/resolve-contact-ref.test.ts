/**
 * Tests for the resolveContactRef graph node.
 *
 * Verifies contact resolution outcomes (resolved/ambiguous/no_match),
 * skip conditions, graceful degradation, and OTel span instrumentation.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

/** Captured span data for assertions. */
let lastSpan: { setAttribute: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } | undefined;
let spanNames: string[] = [];

vi.mock("@opentelemetry/api", () => ({
	trace: {
		getTracer: () => ({
			startActiveSpan: (
				name: string,
				fn: (span: {
					setAttribute: ReturnType<typeof vi.fn>;
					end: ReturnType<typeof vi.fn>;
				}) => unknown,
			) => {
				const span = {
					setAttribute: vi.fn(),
					end: vi.fn(),
				};
				lastSpan = span;
				spanNames.push(name);
				return fn(span);
			},
		}),
	},
}));

vi.mock("@monica-companion/observability", () => ({
	createLogger: () => ({
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
	}),
}));

vi.mock("../../../contact-resolution/client.js", () => ({
	fetchContactSummaries: vi.fn(),
}));

import type { ContactResolutionSummary } from "@monica-companion/types";
import { fetchContactSummaries } from "../../../contact-resolution/client.js";
import type { IntentClassificationResult } from "../../intent-schemas.js";
import { createResolveContactRefNode } from "../resolve-contact-ref.js";

const mockFetchContactSummaries = vi.mocked(fetchContactSummaries);

function makeState(
	intentClassification: IntentClassificationResult | null,
	overrides: Record<string, unknown> = {},
) {
	return {
		userId: "550e8400-e29b-41d4-a716-446655440000",
		correlationId: "corr-123",
		inboundEvent: {
			type: "text_message" as const,
			userId: "550e8400-e29b-41d4-a716-446655440000",
			sourceRef: "telegram:msg:456",
			correlationId: "corr-123",
			text: "Add a note to John about the meeting",
		},
		recentTurns: [],
		activePendingCommand: null,
		contactResolution: null,
		contactSummariesCache: null,
		userPreferences: null,
		intentClassification,
		actionOutcome: null,
		narrowingContext: null,
		response: null,
		...overrides,
	};
}

const mockServiceClient = { fetch: vi.fn() } as any;

function makeDeps() {
	return { monicaIntegrationClient: mockServiceClient };
}

function makeSummary(overrides: Partial<ContactResolutionSummary> = {}): ContactResolutionSummary {
	return {
		contactId: 1,
		displayName: "John Doe",
		aliases: ["John"],
		relationshipLabels: ["friend"],
		importantDates: [],
		lastInteractionAt: null,
		...overrides,
	};
}

describe("resolveContactRefNode", () => {
	afterEach(() => {
		lastSpan = undefined;
		spanNames = [];
		vi.clearAllMocks();
	});

	// --- Resolved outcome ---

	it("resolves a single exact-match contact and injects contactId into commandPayload", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({ contactId: 42, displayName: "John Doe", aliases: ["John", "Doe"] }),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll add a note to John about the meeting.",
			commandType: "create_note",
			contactRef: "John Doe",
			commandPayload: { body: "meeting notes" },
			confidence: 0.9,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		expect(update.contactResolution).toBeDefined();
		expect(update.contactResolution?.outcome).toBe("resolved");
		expect(update.contactResolution?.resolved?.contactId).toBe(42);
		expect(update.intentClassification?.commandPayload).toEqual({
			body: "meeting notes",
			contactId: 42,
		});
		expect(update.intentClassification?.needsClarification).toBe(false);
		expect(update.contactSummariesCache).toEqual(summaries);
	});

	// --- Ambiguous outcome ---

	it("returns ambiguous when multiple contacts match and sets disambiguationOptions with real data", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({
				contactId: 10,
				displayName: "Sherry Miller",
				aliases: ["Sherry", "Miller"],
				relationshipLabels: ["friend"],
			}),
			makeSummary({
				contactId: 20,
				displayName: "Sherry Johnson",
				aliases: ["Sherry", "Johnson"],
				relationshipLabels: ["colleague"],
			}),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll add a note to Sherry.",
			commandType: "create_note",
			contactRef: "Sherry",
			commandPayload: { body: "coffee" },
			confidence: 0.85,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		expect(update.contactResolution?.outcome).toBe("ambiguous");
		expect(update.intentClassification?.needsClarification).toBe(true);
		expect(update.intentClassification?.clarificationReason).toBe("ambiguous_contact");
		expect(update.intentClassification?.disambiguationOptions).toEqual([
			{ label: "Sherry Miller", value: "10" },
			{ label: "Sherry Johnson", value: "20" },
		]);
	});

	// --- No match outcome ---

	it("returns no_match when no contacts match and preserves LLM userFacingText (M3 fix)", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({ contactId: 1, displayName: "Alice Smith", aliases: ["Alice", "Smith"] }),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "fr",
			userFacingText: "Je vais ajouter une note pour Xavier.",
			commandType: "create_note",
			contactRef: "Xavier",
			commandPayload: { body: "meeting" },
			confidence: 0.8,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		expect(update.contactResolution?.outcome).toBe("no_match");
		expect(update.intentClassification?.needsClarification).toBe(true);
		expect(update.intentClassification?.clarificationReason).toBe("ambiguous_contact");
		// M3 fix: preserve the LLM's original userFacingText instead of hardcoded English
		expect(update.intentClassification?.userFacingText).toBe(
			"Je vais ajouter une note pour Xavier.",
		);
	});

	// --- Skip conditions ---

	it("skips resolution for create_contact command type", async () => {
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll create a contact named Xavier.",
			commandType: "create_contact",
			contactRef: "Xavier",
			commandPayload: { firstName: "Xavier" },
			confidence: 0.9,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		expect(update).toEqual({});
		expect(mockFetchContactSummaries).not.toHaveBeenCalled();
	});

	it("skips resolution when contactRef is null", async () => {
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "What should I do?",
			commandType: "create_note",
			contactRef: null,
			commandPayload: { body: "meeting" },
			confidence: 0.5,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		expect(update).toEqual({});
		expect(mockFetchContactSummaries).not.toHaveBeenCalled();
	});

	it("skips resolution when intentClassification is null", async () => {
		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(null));

		expect(update).toEqual({});
		expect(mockFetchContactSummaries).not.toHaveBeenCalled();
	});

	it("skips resolution for greeting intent", async () => {
		const classification: IntentClassificationResult = {
			intent: "greeting",
			detectedLanguage: "en",
			userFacingText: "Hello!",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.99,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		expect(update).toEqual({});
	});

	it("skips resolution for out_of_scope intent", async () => {
		const classification: IntentClassificationResult = {
			intent: "out_of_scope",
			detectedLanguage: "en",
			userFacingText: "I can only help with CRM tasks.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.95,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		expect(update).toEqual({});
	});

	// --- Graceful degradation (M2 fix) ---

	it("returns empty state update on fetchContactSummaries failure (M2 fix)", async () => {
		mockFetchContactSummaries.mockRejectedValue(new Error("Service unreachable"));

		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll add a note to John.",
			commandType: "create_note",
			contactRef: "John",
			commandPayload: { body: "meeting" },
			confidence: 0.9,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		// M2 fix: return {} (no state changes) instead of mapping to no_match
		expect(update).toEqual({});
	});

	// --- Cache behavior ---

	it("uses cached summaries when contactSummariesCache is already populated", async () => {
		const cachedSummaries: ContactResolutionSummary[] = [
			makeSummary({ contactId: 42, displayName: "John Doe", aliases: ["John", "Doe"] }),
		];

		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll add a note to John Doe.",
			commandType: "create_note",
			contactRef: "John Doe",
			commandPayload: { body: "meeting" },
			confidence: 0.9,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(
			makeState(classification, { contactSummariesCache: cachedSummaries }),
		);

		expect(mockFetchContactSummaries).not.toHaveBeenCalled();
		expect(update.contactResolution?.outcome).toBe("resolved");
		expect(update.contactResolution?.resolved?.contactId).toBe(42);
	});

	// --- Read query support ---

	it("resolves contacts for read_query intents", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({ contactId: 42, displayName: "Jane Doe", aliases: ["Jane", "Doe"] }),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "read_query",
			detectedLanguage: "en",
			userFacingText: "Jane's birthday is March 15th.",
			commandType: "query_birthday",
			contactRef: "Jane Doe",
			commandPayload: { contactId: 99 },
			confidence: 0.92,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		expect(update.contactResolution?.outcome).toBe("resolved");
		expect(update.intentClassification?.commandPayload).toEqual({
			contactId: 42,
		});
	});

	// --- OTel span instrumentation (M1 fix) ---

	it("creates a span named ai-router.graph.resolve_contact_ref and records outcome", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({ contactId: 42, displayName: "John Doe", aliases: ["John", "Doe"] }),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Adding a note to John Doe.",
			commandType: "create_note",
			contactRef: "John Doe",
			commandPayload: { body: "meeting" },
			confidence: 0.9,
		};

		const node = createResolveContactRefNode(makeDeps());
		await node(makeState(classification));

		expect(spanNames).toContain("ai-router.graph.resolve_contact_ref");
		expect(lastSpan?.setAttribute).toHaveBeenCalledWith("ai-router.resolution_outcome", "resolved");
		expect(lastSpan?.end).toHaveBeenCalled();
	});

	it("records skipped outcome as span attribute when resolution is skipped", async () => {
		const classification: IntentClassificationResult = {
			intent: "greeting",
			detectedLanguage: "en",
			userFacingText: "Hello!",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.99,
		};

		const node = createResolveContactRefNode(makeDeps());
		await node(makeState(classification));

		expect(spanNames).toContain("ai-router.graph.resolve_contact_ref");
		expect(lastSpan?.setAttribute).toHaveBeenCalledWith("ai-router.resolution_outcome", "skipped");
		expect(lastSpan?.end).toHaveBeenCalled();
	});

	it("ends span even when fetch fails", async () => {
		mockFetchContactSummaries.mockRejectedValue(new Error("Network error"));

		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Adding a note to John.",
			commandType: "create_note",
			contactRef: "John",
			commandPayload: { body: "meeting" },
			confidence: 0.9,
		};

		const node = createResolveContactRefNode(makeDeps());
		await node(makeState(classification));

		expect(lastSpan?.end).toHaveBeenCalled();
		expect(lastSpan?.setAttribute).toHaveBeenCalledWith(
			"ai-router.resolution_outcome",
			"fetch_error",
		);
	});

	// --- clarification_response with contactRef resolves (bug fix) ---

	it("resolves contact for clarification_response with contactRef", async () => {
		// Reproduces the scenario where a retried voice message was classified as
		// clarification_response with a contactRef. Previously, resolution was
		// skipped for clarification_response, causing contactId to be missing.
		const summaries: ContactResolutionSummary[] = [
			makeSummary({ contactId: 77, displayName: "Elena Yuryevna", aliases: ["Elena", "Yuryevna"] }),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "I'll create a note about the artillery park.",
			commandType: "create_note",
			contactRef: "Elena Yuryevna",
			commandPayload: { body: "Today we talked about going to the artillery park." },
			confidence: 0.85,
			needsClarification: false,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		expect(update.contactResolution?.outcome).toBe("resolved");
		expect(update.intentClassification?.commandPayload).toEqual({
			body: "Today we talked about going to the artillery park.",
			contactId: 77,
		});
		expect(update.intentClassification?.needsClarification).toBe(false);
	});

	// --- callback_action skip (Bug: select callback re-triggers disambiguation) ---

	it("skips resolution for callback_action events to prevent re-disambiguation", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({
				contactId: 10,
				displayName: "Elena Yuryevna",
				aliases: ["Elena", "Yuryevna"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 20,
				displayName: "Maria Petrova",
				aliases: ["Maria", "Petrova"],
				relationshipLabels: ["parent"],
			}),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		// LLM classified the select callback as clarification_response with a contactRef.
		// resolveContactRef should NOT run for callback_action events.
		const classification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Got it — thanks for the selection.",
			commandType: "create_note",
			contactRef: "mom",
			commandPayload: { body: "Went to artillery park" },
			confidence: 0.9,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(
			makeState(classification, {
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:999",
					correlationId: "corr-123",
					action: "select",
					data: "10:0",
				},
			}),
		);

		// Should skip — no state changes, no fetch
		expect(update).toEqual({});
		expect(mockFetchContactSummaries).not.toHaveBeenCalled();
	});

	// --- Disambiguation label format ---

	it("strips parenthetical from displayName before appending relationship label to avoid double parens", async () => {
		// Monica formats complete_name as "Elena Yuryevna (Mama)" when nickname is set.
		// buildDisambiguationLabel must not produce "Elena Yuryevna (Mama) (parent)".
		const summaries: ContactResolutionSummary[] = [
			makeSummary({
				contactId: 10,
				displayName: "Elena Yuryevna (Mama)",
				aliases: ["Mama", "Elena", "Yuryevna"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 20,
				displayName: "Maria Petrova (Мария)",
				aliases: ["Мария", "Maria", "Petrova"],
				relationshipLabels: ["parent"],
			}),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Adding a note to mom.",
			commandType: "create_note",
			contactRef: "mom",
			commandPayload: { body: "went to the park" },
			confidence: 0.85,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		// Should produce clean single-parenthetical labels, not "Elena Yuryevna (Mama) (parent)".
		// Alias "Mama"/"Мария" is useful (not in stripped base name), so it takes priority.
		expect(update.intentClassification?.disambiguationOptions).toEqual([
			{ label: "Elena Yuryevna (Mama)", value: "10" },
			{ label: "Maria Petrova (Мария)", value: "20" },
		]);
	});

	it("strips parenthetical and uses base name when alias is not useful and no DOB", async () => {
		// When complete_name has nickname in parens but no useful alias exists
		// and no birthdate, just show the stripped base name.
		const summaries: ContactResolutionSummary[] = [
			makeSummary({
				contactId: 10,
				displayName: "Elena Yuryevna (Elena)",
				aliases: ["Elena", "Yuryevna"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 20,
				displayName: "Elena Petrova (Elena)",
				aliases: ["Elena", "Petrova"],
				relationshipLabels: ["colleague"],
			}),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Adding a note to Elena.",
			commandType: "create_note",
			contactRef: "Elena",
			commandPayload: { body: "coffee" },
			confidence: 0.85,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		expect(update.intentClassification?.disambiguationOptions).toEqual([
			{ label: "Elena Yuryevna", value: "10" },
			{ label: "Elena Petrova", value: "20" },
		]);
	});

	// --- Progressive narrowing: 5a - Initial narrowing detection ---

	it("triggers narrowing when ambiguous candidates exceed threshold (>5)", async () => {
		// Create 8 contacts all matching "mom" via kinship
		const summaries: ContactResolutionSummary[] = Array.from({ length: 8 }, (_, i) =>
			makeSummary({
				contactId: i + 1,
				displayName: `Contact ${i + 1}`,
				aliases: [`Alias${i + 1}`],
				relationshipLabels: ["parent"],
			}),
		);
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Adding a note to mom.",
			commandType: "create_note",
			contactRef: "mom",
			commandPayload: { body: "test" },
			confidence: 0.85,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		// Should trigger narrowing: text clarification, no buttons
		expect(update.intentClassification?.needsClarification).toBe(true);
		expect(update.intentClassification?.disambiguationOptions).toBeUndefined();
		expect(update.intentClassification?.userFacingText).toContain("8 contacts");
		expect(update.intentClassification?.userFacingText).toContain("mom");
		expect(update.narrowingContext).not.toBeNull();
		expect(update.narrowingContext?.round).toBe(0);
		expect(update.narrowingContext?.narrowingCandidateIds).toHaveLength(8);
		expect(update.narrowingContext?.originalContactRef).toBe("mom");
	});

	it("does NOT trigger narrowing when ambiguous candidates are within threshold (<=5)", async () => {
		const summaries: ContactResolutionSummary[] = Array.from({ length: 4 }, (_, i) =>
			makeSummary({
				contactId: i + 1,
				displayName: `Contact ${i + 1}`,
				aliases: [`Alias${i + 1}`],
				relationshipLabels: ["parent"],
			}),
		);
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Adding a note to mom.",
			commandType: "create_note",
			contactRef: "mom",
			commandPayload: { body: "test" },
			confidence: 0.85,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		// Should use normal disambiguation buttons
		expect(update.intentClassification?.needsClarification).toBe(true);
		expect(update.intentClassification?.disambiguationOptions).toBeDefined();
		expect(update.intentClassification?.disambiguationOptions?.length).toBe(4);
		expect(update.narrowingContext).toBeUndefined(); // not set in state update
	});

	// --- Progressive narrowing: 5b - Subsequent narrowing round ---

	it("narrows pool on clarification_response with existing narrowingContext", async () => {
		// Pool of 8 contacts; user says "Elena" to narrow
		const summaries: ContactResolutionSummary[] = [
			makeSummary({
				contactId: 1,
				displayName: "Elena Yuryevna",
				aliases: ["Elena", "Yuryevna"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 2,
				displayName: "Maria Petrova",
				aliases: ["Maria", "Petrova"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 3,
				displayName: "Elena Smirnova",
				aliases: ["Elena", "Smirnova"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 4,
				displayName: "Olga Ivanova",
				aliases: ["Olga", "Ivanova"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 5,
				displayName: "Anna Kozlova",
				aliases: ["Anna", "Kozlova"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 6,
				displayName: "Svetlana Popova",
				aliases: ["Svetlana", "Popova"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 7,
				displayName: "Natalia Sokolova",
				aliases: ["Natalia", "Sokolova"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 8,
				displayName: "Irina Lebedeva",
				aliases: ["Irina", "Lebedeva"],
				relationshipLabels: ["parent"],
			}),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Elena",
			commandType: "create_note",
			contactRef: "Elena",
			commandPayload: { body: "test" },
			confidence: 0.8,
		};

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: [],
			round: 0,
			narrowingCandidateIds: [1, 2, 3, 4, 5, 6, 7, 8],
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification, { narrowingContext }));

		// "Elena" matches contactId 1 and 3 -> 2 matches -> present buttons
		expect(update.intentClassification?.needsClarification).toBe(true);
		expect(update.intentClassification?.disambiguationOptions).toBeDefined();
		expect(update.intentClassification?.disambiguationOptions?.length).toBe(2);
		expect(update.narrowingContext).toBeNull(); // clear narrowing when showing buttons
	});

	it("resolves to single contact when narrowing produces exactly 1 match", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({
				contactId: 1,
				displayName: "Elena Yuryevna",
				aliases: ["Elena", "Yuryevna"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 2,
				displayName: "Maria Petrova",
				aliases: ["Maria", "Petrova"],
				relationshipLabels: ["parent"],
			}),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Maria",
			commandType: "create_note",
			contactRef: "Maria",
			commandPayload: { body: "test" },
			confidence: 0.8,
		};

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: [],
			round: 0,
			narrowingCandidateIds: [1, 2],
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification, { narrowingContext }));

		// Single match -> resolved
		expect(update.contactResolution?.outcome).toBe("resolved");
		expect(update.contactResolution?.resolved?.contactId).toBe(2);
		expect(update.intentClassification?.commandPayload?.contactId).toBe(2);
		expect(update.intentClassification?.needsClarification).toBe(false);
		expect(update.narrowingContext).toBeNull();
	});

	it("returns no-match fallback when narrowing pool reaches 0", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({
				contactId: 1,
				displayName: "Elena Yuryevna",
				aliases: ["Elena", "Yuryevna"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 2,
				displayName: "Maria Petrova",
				aliases: ["Maria", "Petrova"],
				relationshipLabels: ["parent"],
			}),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Xavier",
			commandType: "create_note",
			contactRef: "Xavier",
			commandPayload: { body: "test" },
			confidence: 0.8,
		};

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: [],
			round: 0,
			narrowingCandidateIds: [1, 2],
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification, { narrowingContext }));

		// 0 matches -> no_match fallback
		expect(update.contactResolution?.outcome).toBe("no_match");
		expect(update.intentClassification?.needsClarification).toBe(true);
		expect(update.narrowingContext).toBeNull();
	});

	it("continues narrowing when pool is still >5 and under round cap", async () => {
		// 8 contacts, 7 of them have "Elena" as alias
		const summaries: ContactResolutionSummary[] = Array.from({ length: 8 }, (_, i) =>
			makeSummary({
				contactId: i + 1,
				displayName: `Elena Contact${i + 1}`,
				aliases: ["Elena", `Contact${i + 1}`],
				relationshipLabels: ["parent"],
			}),
		);
		// Last one does not match Elena
		summaries[7] = makeSummary({
			contactId: 8,
			displayName: "Olga Ivanova",
			aliases: ["Olga", "Ivanova"],
			relationshipLabels: ["parent"],
		});
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Elena",
			commandType: "create_note",
			contactRef: "Elena",
			commandPayload: { body: "test" },
			confidence: 0.8,
		};

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: [],
			round: 0,
			narrowingCandidateIds: [1, 2, 3, 4, 5, 6, 7, 8],
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification, { narrowingContext }));

		// 7 matches -> still > 5, continue narrowing
		expect(update.intentClassification?.needsClarification).toBe(true);
		expect(update.intentClassification?.disambiguationOptions).toBeUndefined();
		expect(update.narrowingContext).not.toBeNull();
		expect(update.narrowingContext?.round).toBe(1);
		expect(update.narrowingContext?.narrowingCandidateIds).toHaveLength(7);
		expect(update.narrowingContext?.clarifications).toContain("Elena");
	});

	it("forces top 5 as buttons at 3-round cap", async () => {
		const summaries: ContactResolutionSummary[] = Array.from({ length: 8 }, (_, i) =>
			makeSummary({
				contactId: i + 1,
				displayName: `Elena Contact${i + 1}`,
				aliases: ["Elena", `Contact${i + 1}`],
				relationshipLabels: ["parent"],
			}),
		);
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Elena",
			commandType: "create_note",
			contactRef: "Elena",
			commandPayload: { body: "test" },
			confidence: 0.8,
		};

		// Round 2 means the next round (2+1=3) would be the cap
		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: ["some term", "another term"],
			round: 2,
			narrowingCandidateIds: [1, 2, 3, 4, 5, 6, 7, 8],
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification, { narrowingContext }));

		// At cap: force top 5 as buttons
		expect(update.intentClassification?.needsClarification).toBe(true);
		expect(update.intentClassification?.disambiguationOptions).toBeDefined();
		expect(update.intentClassification?.disambiguationOptions?.length).toBeLessThanOrEqual(5);
		expect(update.narrowingContext).toBeNull();
	});

	// --- Progressive narrowing: 5c - Abandonment ---

	it("abandons narrowing when intent is not clarification_response", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({ contactId: 42, displayName: "John Doe", aliases: ["John", "Doe"] }),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Adding a note to John.",
			commandType: "create_note",
			contactRef: "John Doe",
			commandPayload: { body: "test" },
			confidence: 0.9,
		};

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: [],
			round: 0,
			narrowingCandidateIds: [1, 2, 3, 4, 5, 6],
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification, { narrowingContext }));

		// Should abandon narrowing and process normally
		expect(update.narrowingContext).toBeNull();
		expect(update.contactResolution?.outcome).toBe("resolved");
		expect(update.contactResolution?.resolved?.contactId).toBe(42);
	});

	it("handles narrowing when contactRef is null in clarification_response (uses text)", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({
				contactId: 1,
				displayName: "Elena Yuryevna",
				aliases: ["Elena", "Yuryevna"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 2,
				displayName: "Maria Petrova",
				aliases: ["Maria", "Petrova"],
				relationshipLabels: ["parent"],
			}),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		// LLM didn't set contactRef but user typed "Elena"
		const classification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Elena",
			commandType: "create_note",
			contactRef: null,
			commandPayload: { body: "test" },
			confidence: 0.8,
		};

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: [],
			round: 0,
			narrowingCandidateIds: [1, 2],
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(
			makeState(classification, {
				narrowingContext,
				inboundEvent: {
					type: "text_message" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:msg:456",
					correlationId: "corr-123",
					text: "Elena",
				},
			}),
		);

		// Should use inbound text as clarification and resolve
		expect(update.contactResolution?.outcome).toBe("resolved");
		expect(update.contactResolution?.resolved?.contactId).toBe(1);
	});

	it("appends birthdate to disambiguation label when available", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({
				contactId: 10,
				displayName: "Elena Yuryevna (Mama)",
				aliases: ["Mama", "Elena", "Yuryevna"],
				relationshipLabels: ["parent"],
				importantDates: [{ label: "birthdate", date: "1965-03-15", isYearUnknown: false }],
			}),
			makeSummary({
				contactId: 20,
				displayName: "Maria Petrova (Мама)",
				aliases: ["Мама", "Maria", "Petrova"],
				relationshipLabels: ["parent"],
				importantDates: [{ label: "birthdate", date: "0000-06-20", isYearUnknown: true }],
			}),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		// "mom" matches both via kinship normalization → "parent" relationship
		const classification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Adding a note to mom.",
			commandType: "create_note",
			contactRef: "mom",
			commandPayload: { body: "coffee" },
			confidence: 0.85,
		};

		const node = createResolveContactRefNode(makeDeps());
		const update = await node(makeState(classification));

		expect(update.intentClassification?.disambiguationOptions).toEqual([
			{ label: "Elena Yuryevna (Mama), b. 15 Mar 1965", value: "10" },
			{ label: "Maria Petrova (Мама), b. 20 Jun", value: "20" },
		]);
	});
});
