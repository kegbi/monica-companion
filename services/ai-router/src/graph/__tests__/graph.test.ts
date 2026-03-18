import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentClassificationResult } from "../intent-schemas.js";
import { GraphResponseSchema } from "../state.js";

// Mock the LLM module to avoid real OpenAI calls
const mockInvoke = vi.fn();

vi.mock("@langchain/openai", () => ({
	ChatOpenAI: vi.fn().mockImplementation(function (this: any) {
		this.withStructuredOutput = vi.fn().mockReturnValue({ invoke: mockInvoke });
	}),
}));

import { createConversationGraph } from "../graph.js";

const greetingResult: IntentClassificationResult = {
	intent: "greeting",
	detectedLanguage: "en",
	userFacingText: "Hello! How can I help you today?",
	commandType: null,
	contactRef: null,
	commandPayload: null,
	confidence: 0.99,
};

const mutatingResult: IntentClassificationResult = {
	intent: "mutating_command",
	detectedLanguage: "en",
	userFacingText: "I'll create a note for Jane about your lunch.",
	commandType: "create_note",
	contactRef: "Jane",
	commandPayload: { body: "our lunch" },
	confidence: 0.95,
};

const mockDb = {} as any;

const mockGetRecentTurns = vi.fn().mockResolvedValue([]);
const mockGetActivePendingCommandForUser = vi.fn().mockResolvedValue(null);
const mockInsertTurnSummary = vi.fn().mockResolvedValue({});
const mockRedactString = vi.fn().mockImplementation((s: string) => s);

function makeConfig() {
	return {
		openaiApiKey: "sk-test-key",
		db: mockDb,
		maxConversationTurns: 10,
		getRecentTurns: mockGetRecentTurns,
		getActivePendingCommandForUser: mockGetActivePendingCommandForUser,
		insertTurnSummary: mockInsertTurnSummary,
		redactString: mockRedactString,
	};
}

describe("createConversationGraph", () => {
	beforeEach(() => {
		mockInvoke.mockReset();
		mockGetRecentTurns.mockReset().mockResolvedValue([]);
		mockGetActivePendingCommandForUser.mockReset().mockResolvedValue(null);
		mockInsertTurnSummary.mockReset().mockResolvedValue({});
		mockRedactString.mockReset().mockImplementation((s: string) => s);
	});

	const makeState = (overrides: Record<string, unknown> = {}) => ({
		userId: "550e8400-e29b-41d4-a716-446655440000",
		correlationId: "corr-123",
		inboundEvent: {
			type: "text_message" as const,
			userId: "550e8400-e29b-41d4-a716-446655440000",
			sourceRef: "telegram:msg:456",
			correlationId: "corr-123",
			text: "Hello bot",
		},
		...overrides,
	});

	it("returns a compiled graph", () => {
		const graph = createConversationGraph(makeConfig());
		expect(graph).toBeDefined();
		expect(typeof graph.invoke).toBe("function");
	});

	it("processes a text_message and returns a valid graph response", async () => {
		mockInvoke.mockResolvedValueOnce(greetingResult);
		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(makeState());

		expect(result.response).not.toBeNull();
		const parsed = GraphResponseSchema.safeParse(result.response);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.type).toBe("text");
			expect(parsed.data.text).toBe("Hello! How can I help you today?");
		}
	});

	it("sets intentClassification in graph state", async () => {
		mockInvoke.mockResolvedValueOnce(mutatingResult);
		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(makeState());

		expect(result.intentClassification).toEqual(mutatingResult);
	});

	it("processes a voice_message event", async () => {
		mockInvoke.mockResolvedValueOnce(mutatingResult);
		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(
			makeState({
				inboundEvent: {
					type: "voice_message" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:msg:789",
					correlationId: "corr-123",
					transcribedText: "Set a reminder for Jane",
				},
			}),
		);

		expect(result.response).not.toBeNull();
		const parsed = GraphResponseSchema.safeParse(result.response);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.type).toBe("text");
		}
	});

	it("processes a callback_action event without calling LLM", async () => {
		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(
			makeState({
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:msg:101",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-123",
				},
			}),
		);

		expect(result.response).not.toBeNull();
		const parsed = GraphResponseSchema.safeParse(result.response);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.type).toBe("text");
		}
		// LLM should not be called for callback_action without active pending command
		expect(mockInvoke).not.toHaveBeenCalled();
	});

	it("preserves userId and correlationId through the graph", async () => {
		mockInvoke.mockResolvedValueOnce(greetingResult);
		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(makeState());

		expect(result.userId).toBe("550e8400-e29b-41d4-a716-446655440000");
		expect(result.correlationId).toBe("corr-123");
	});

	it("handles LLM errors gracefully", async () => {
		mockInvoke.mockRejectedValueOnce(new Error("LLM timeout"));
		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(makeState());

		expect(result.response).not.toBeNull();
		expect(result.intentClassification!.intent).toBe("out_of_scope");
		expect(result.intentClassification!.confidence).toBe(0);
	});

	// --- New topology tests ---

	it("loads context from DB via loadContext node", async () => {
		mockInvoke.mockResolvedValueOnce(greetingResult);
		const graph = createConversationGraph(makeConfig());
		await graph.invoke(makeState());

		expect(mockGetRecentTurns).toHaveBeenCalledWith(
			mockDb,
			"550e8400-e29b-41d4-a716-446655440000",
			10,
		);
		expect(mockGetActivePendingCommandForUser).toHaveBeenCalledWith(
			mockDb,
			"550e8400-e29b-41d4-a716-446655440000",
		);
	});

	it("persists turn summaries via persistTurn node", async () => {
		mockInvoke.mockResolvedValueOnce(greetingResult);
		const graph = createConversationGraph(makeConfig());
		await graph.invoke(makeState());

		// Should insert user turn and assistant turn
		expect(mockInsertTurnSummary).toHaveBeenCalledTimes(2);
	});

	it("passes turn summaries through redaction", async () => {
		mockInvoke.mockResolvedValueOnce(greetingResult);
		const graph = createConversationGraph(makeConfig());
		await graph.invoke(makeState());

		expect(mockRedactString).toHaveBeenCalledTimes(2);
	});
});
