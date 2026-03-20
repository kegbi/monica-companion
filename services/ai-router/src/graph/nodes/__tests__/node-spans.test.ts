/**
 * Tests for OTel span instrumentation on LangGraph nodes.
 *
 * Verifies that each node:
 * 1. Creates a span with the correct name
 * 2. Calls span.end() on success
 * 3. Calls span.end() even when the inner function throws
 * 4. Records structural metadata (not PII) in span attributes
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

import type { IntentClassificationResult } from "../../intent-schemas.js";
import { createClassifyIntentNode } from "../classify-intent.js";
import { createDeliverResponseNode } from "../deliver-response.js";
import { createExecuteActionNode } from "../execute-action.js";
import { formatResponseNode } from "../format-response.js";
import { createLoadContextNode } from "../load-context.js";
import { createPersistTurnNode } from "../persist-turn.js";

function makeBaseState(overrides: Record<string, unknown> = {}) {
	return {
		userId: "550e8400-e29b-41d4-a716-446655440000",
		correlationId: "corr-123",
		inboundEvent: {
			type: "text_message" as const,
			userId: "550e8400-e29b-41d4-a716-446655440000",
			sourceRef: "telegram:msg:456",
			correlationId: "corr-123",
			text: "Hello",
		},
		recentTurns: [],
		activePendingCommand: null,
		resolvedContact: null,
		userPreferences: null,
		response: null,
		intentClassification: null,
		actionOutcome: null,
		...overrides,
	};
}

describe("Node OTel span instrumentation", () => {
	afterEach(() => {
		lastSpan = undefined;
		spanNames = [];
		vi.clearAllMocks();
	});

	describe("loadContextNode", () => {
		it("creates a span named ai-router.graph.load_context and ends it on success", async () => {
			const node = createLoadContextNode({
				db: {} as any,
				maxTurns: 10,
				getRecentTurns: vi.fn().mockResolvedValue([]),
				getActivePendingCommandForUser: vi.fn().mockResolvedValue(null),
			});

			await node(makeBaseState());

			expect(spanNames).toContain("ai-router.graph.load_context");
			expect(lastSpan?.end).toHaveBeenCalled();
		});

		it("ends span even when inner function throws", async () => {
			const node = createLoadContextNode({
				db: {} as any,
				maxTurns: 10,
				getRecentTurns: vi.fn().mockRejectedValue(new Error("DB error")),
				getActivePendingCommandForUser: vi.fn().mockResolvedValue(null),
			});

			await expect(node(makeBaseState())).rejects.toThrow("DB error");
			expect(lastSpan?.end).toHaveBeenCalled();
		});
	});

	describe("classifyIntentNode", () => {
		it("creates a span named ai-router.graph.classify_intent and ends it on success", async () => {
			const classifier = {
				invoke: vi.fn().mockResolvedValue({
					intent: "greeting",
					detectedLanguage: "en",
					userFacingText: "Hello!",
					commandType: null,
					contactRef: null,
					commandPayload: null,
					confidence: 0.99,
				}),
			};
			const node = createClassifyIntentNode(classifier);

			await node(makeBaseState());

			expect(spanNames).toContain("ai-router.graph.classify_intent");
			expect(lastSpan?.end).toHaveBeenCalled();
		});

		it("records intent type as span attribute", async () => {
			const classifier = {
				invoke: vi.fn().mockResolvedValue({
					intent: "greeting",
					detectedLanguage: "en",
					userFacingText: "Hello!",
					commandType: null,
					contactRef: null,
					commandPayload: null,
					confidence: 0.99,
				}),
			};
			const node = createClassifyIntentNode(classifier);

			await node(makeBaseState());

			expect(lastSpan?.setAttribute).toHaveBeenCalledWith("ai-router.intent", "greeting");
		});

		it("ends span even when classifier throws (uses fallback)", async () => {
			const classifier = {
				invoke: vi.fn().mockRejectedValue(new Error("LLM timeout")),
			};
			const node = createClassifyIntentNode(classifier);

			// classifyIntentNode handles errors internally with a fallback
			await node(makeBaseState());

			expect(lastSpan?.end).toHaveBeenCalled();
		});
	});

	describe("executeActionNode", () => {
		it("creates a span named ai-router.graph.execute_action and ends it on success", async () => {
			const node = createExecuteActionNode({
				db: {} as any,
				pendingCommandTtlMinutes: 30,
				autoConfirmConfidenceThreshold: 0.95,
				createPendingCommand: vi.fn(),
				transitionStatus: vi.fn(),
				getPendingCommand: vi.fn(),
				updateDraftPayload: vi.fn(),
				buildConfirmedPayload: vi.fn(),
				schedulerClient: { execute: vi.fn() },
				userManagementClient: { getPreferences: vi.fn(), getDeliveryRouting: vi.fn() },
			});

			const state = makeBaseState({
				intentClassification: {
					intent: "greeting",
					detectedLanguage: "en",
					userFacingText: "Hello!",
					commandType: null,
					contactRef: null,
					commandPayload: null,
					confidence: 0.99,
				},
			});

			await node(state);

			expect(spanNames).toContain("ai-router.graph.execute_action");
			expect(lastSpan?.end).toHaveBeenCalled();
		});

		it("records action outcome type as span attribute", async () => {
			const node = createExecuteActionNode({
				db: {} as any,
				pendingCommandTtlMinutes: 30,
				autoConfirmConfidenceThreshold: 0.95,
				createPendingCommand: vi.fn(),
				transitionStatus: vi.fn(),
				getPendingCommand: vi.fn(),
				updateDraftPayload: vi.fn(),
				buildConfirmedPayload: vi.fn(),
				schedulerClient: { execute: vi.fn() },
				userManagementClient: { getPreferences: vi.fn(), getDeliveryRouting: vi.fn() },
			});

			const state = makeBaseState({
				intentClassification: {
					intent: "greeting",
					detectedLanguage: "en",
					userFacingText: "Hello!",
					commandType: null,
					contactRef: null,
					commandPayload: null,
					confidence: 0.99,
				},
			});

			await node(state);

			expect(lastSpan?.setAttribute).toHaveBeenCalledWith(
				"ai-router.action_outcome",
				"passthrough",
			);
		});
	});

	describe("formatResponseNode", () => {
		it("creates a span named ai-router.graph.format_response and ends it on success", () => {
			const state = makeBaseState({
				intentClassification: {
					intent: "greeting",
					detectedLanguage: "en",
					userFacingText: "Hello!",
					commandType: null,
					contactRef: null,
					commandPayload: null,
					confidence: 0.99,
				},
			});

			formatResponseNode(state);

			expect(spanNames).toContain("ai-router.graph.format_response");
			expect(lastSpan?.end).toHaveBeenCalled();
		});
	});

	describe("deliverResponseNode", () => {
		it("creates a span named ai-router.graph.deliver_response and ends it on success", async () => {
			const node = createDeliverResponseNode({
				deliveryClient: { deliver: vi.fn().mockResolvedValue({}) },
				userManagementClient: {
					getDeliveryRouting: vi.fn().mockResolvedValue({
						connectorType: "telegram",
						connectorRoutingId: "chat-123",
					}),
				},
			});

			const state = makeBaseState({
				response: { type: "text", text: "Hello!" },
			});

			await node(state);

			expect(spanNames).toContain("ai-router.graph.deliver_response");
			expect(lastSpan?.end).toHaveBeenCalled();
		});

		it("ends span even when delivery fails", async () => {
			const node = createDeliverResponseNode({
				deliveryClient: {
					deliver: vi.fn().mockRejectedValue(new Error("timeout")),
				},
				userManagementClient: {
					getDeliveryRouting: vi.fn().mockResolvedValue({
						connectorType: "telegram",
						connectorRoutingId: "chat-123",
					}),
				},
			});

			const state = makeBaseState({
				response: { type: "text", text: "Hello!" },
			});

			// Should not throw (best-effort delivery)
			await node(state);

			expect(lastSpan?.end).toHaveBeenCalled();
		});
	});

	describe("persistTurnNode", () => {
		it("creates a span named ai-router.graph.persist_turn and ends it on success", async () => {
			const node = createPersistTurnNode({
				db: {} as any,
				insertTurnSummary: vi.fn().mockResolvedValue({}),
				redactString: (s: string) => s,
			});

			const state = makeBaseState({
				intentClassification: {
					intent: "greeting",
					detectedLanguage: "en",
					userFacingText: "Hello!",
					commandType: null,
					contactRef: null,
					commandPayload: null,
					confidence: 0.99,
				},
				response: { type: "text", text: "Hello!" },
			});

			await node(state);

			expect(spanNames).toContain("ai-router.graph.persist_turn");
			expect(lastSpan?.end).toHaveBeenCalled();
		});

		it("ends span even when DB fails", async () => {
			const node = createPersistTurnNode({
				db: {} as any,
				insertTurnSummary: vi.fn().mockRejectedValue(new Error("DB error")),
				redactString: (s: string) => s,
			});

			const state = makeBaseState({
				intentClassification: {
					intent: "greeting",
					detectedLanguage: "en",
					userFacingText: "Hello!",
					commandType: null,
					contactRef: null,
					commandPayload: null,
					confidence: 0.99,
				},
				response: { type: "text", text: "Hello!" },
			});

			// Should not throw (best-effort persistence)
			await node(state);

			expect(lastSpan?.end).toHaveBeenCalled();
		});
	});
});
