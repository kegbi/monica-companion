import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/api", () => ({
	trace: {
		getTracer: () => ({
			startActiveSpan: (_name: string, fn: (span: unknown) => unknown) =>
				fn({ setAttribute: () => {}, end: () => {} }),
		}),
	},
}));

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
	commandPayload: { contactId: 42, body: "our lunch" },
	confidence: 0.95,
};

const mockDb = {} as any;

const mockGetRecentTurns = vi.fn().mockResolvedValue([]);
const mockGetActivePendingCommandForUser = vi.fn().mockResolvedValue(null);
const mockInsertTurnSummary = vi.fn().mockResolvedValue({});
const mockRedactString = vi.fn().mockImplementation((s: string) => s);
const mockCreatePendingCommand = vi.fn();
const mockTransitionStatus = vi.fn();
const mockGetPendingCommand = vi.fn();
const mockUpdateDraftPayload = vi.fn();
const mockSchedulerExecute = vi.fn().mockResolvedValue({ executionId: "exec-1", status: "queued" });
const mockDeliveryDeliver = vi.fn().mockResolvedValue({ deliveryId: "del-1", status: "delivered" });
const mockGetDeliveryRouting = vi
	.fn()
	.mockResolvedValue({ connectorType: "telegram", connectorRoutingId: "chat-1" });
const mockGetPreferences = vi
	.fn()
	.mockResolvedValue({ language: "en", confirmationMode: "explicit", timezone: "UTC" });

function makeConfig() {
	return {
		openaiApiKey: "sk-test-key",
		db: mockDb,
		maxConversationTurns: 10,
		pendingCommandTtlMinutes: 30,
		autoConfirmConfidenceThreshold: 0.95,
		getRecentTurns: mockGetRecentTurns,
		getActivePendingCommandForUser: mockGetActivePendingCommandForUser,
		insertTurnSummary: mockInsertTurnSummary,
		redactString: mockRedactString,
		createPendingCommand: mockCreatePendingCommand,
		transitionStatus: mockTransitionStatus,
		getPendingCommand: mockGetPendingCommand,
		updateDraftPayload: mockUpdateDraftPayload,
		schedulerClient: { execute: mockSchedulerExecute },
		deliveryClient: { deliver: mockDeliveryDeliver },
		userManagementClient: {
			getDeliveryRouting: mockGetDeliveryRouting,
			getPreferences: mockGetPreferences,
		},
	};
}

describe("createConversationGraph", () => {
	beforeEach(() => {
		mockInvoke.mockReset();
		mockGetRecentTurns.mockReset().mockResolvedValue([]);
		mockGetActivePendingCommandForUser.mockReset().mockResolvedValue(null);
		mockInsertTurnSummary.mockReset().mockResolvedValue({});
		mockRedactString.mockReset().mockImplementation((s: string) => s);
		mockCreatePendingCommand.mockReset();
		mockTransitionStatus.mockReset();
		mockGetPendingCommand.mockReset();
		mockUpdateDraftPayload.mockReset();
		mockSchedulerExecute.mockReset().mockResolvedValue({ executionId: "exec-1", status: "queued" });
		mockDeliveryDeliver.mockReset().mockResolvedValue({ deliveryId: "del-1", status: "delivered" });
		mockGetDeliveryRouting
			.mockReset()
			.mockResolvedValue({ connectorType: "telegram", connectorRoutingId: "chat-1" });
		mockGetPreferences
			.mockReset()
			.mockResolvedValue({ language: "en", confirmationMode: "explicit", timezone: "UTC" });
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

		// For mutating commands, executeAction creates a pending command
		const createdRow = {
			id: "cmd-1",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "our lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "telegram:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockCreatePendingCommand.mockResolvedValue(createdRow);
		mockTransitionStatus.mockResolvedValue({
			...createdRow,
			status: "pending_confirmation",
			version: 2,
		});

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(makeState());

		expect(result.intentClassification).toEqual(mutatingResult);
	});

	it("processes a voice_message event", async () => {
		mockInvoke.mockResolvedValueOnce(mutatingResult);

		const createdRow = {
			id: "cmd-v",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "our lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "telegram:msg:789",
			correlationId: "corr-123",
			expiresAt: new Date(),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockCreatePendingCommand.mockResolvedValue(createdRow);
		mockTransitionStatus.mockResolvedValue({
			...createdRow,
			status: "pending_confirmation",
			version: 2,
		});

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
		expect(result.intentClassification?.intent).toBe("out_of_scope");
		expect(result.intentClassification?.confidence).toBe(0);
	});

	// --- Topology tests ---

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

	// --- Pipeline wiring tests ---

	it("creates pending command and returns confirmation_prompt for mutating intent", async () => {
		mockInvoke.mockResolvedValueOnce(mutatingResult);

		const createdRow = {
			id: "cmd-pipe",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "our lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "telegram:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockCreatePendingCommand.mockResolvedValue(createdRow);
		mockTransitionStatus.mockResolvedValue({
			...createdRow,
			status: "pending_confirmation",
			version: 2,
		});

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(makeState());

		expect(result.response?.type).toBe("confirmation_prompt");
		expect(result.response?.pendingCommandId).toBe("cmd-pipe");
		expect(result.response?.version).toBe(2);
	});

	it("delivers response via delivery service for greeting", async () => {
		mockInvoke.mockResolvedValueOnce(greetingResult);

		const graph = createConversationGraph(makeConfig());
		await graph.invoke(makeState());

		expect(mockDeliveryDeliver).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "550e8400-e29b-41d4-a716-446655440000",
				connectorType: "telegram",
				connectorRoutingId: "chat-1",
				content: { type: "text", text: "Hello! How can I help you today?" },
			}),
		);
	});

	it("delivers confirmation_prompt via delivery service for mutating command", async () => {
		mockInvoke.mockResolvedValueOnce(mutatingResult);

		const createdRow = {
			id: "cmd-del",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "our lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "telegram:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockCreatePendingCommand.mockResolvedValue(createdRow);
		mockTransitionStatus.mockResolvedValue({
			...createdRow,
			status: "pending_confirmation",
			version: 2,
		});

		const graph = createConversationGraph(makeConfig());
		await graph.invoke(makeState());

		expect(mockDeliveryDeliver).toHaveBeenCalledWith(
			expect.objectContaining({
				content: expect.objectContaining({
					type: "confirmation_prompt",
					pendingCommandId: "cmd-del",
					version: 2,
				}),
			}),
		);
	});

	// --- Step 5: Compiled graph integration tests ---

	it("auto-confirms when user preferences allow and confidence exceeds threshold", async () => {
		const highConfResult: IntentClassificationResult = {
			...mutatingResult,
			confidence: 0.97,
		};
		mockInvoke.mockResolvedValueOnce(highConfResult);
		mockGetPreferences.mockResolvedValue({
			language: "en",
			confirmationMode: "auto",
			timezone: "UTC",
		});

		const createdRow = {
			id: "cmd-auto",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "our lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "telegram:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		const pendingConfRow = { ...createdRow, status: "pending_confirmation", version: 2 };
		const confirmedRow = {
			...pendingConfRow,
			status: "confirmed",
			version: 3,
			confirmedAt: new Date(),
		};

		mockCreatePendingCommand.mockResolvedValue(createdRow);
		mockTransitionStatus
			.mockResolvedValueOnce(pendingConfRow) // draft -> pending_confirmation
			.mockResolvedValueOnce(confirmedRow); // pending_confirmation -> confirmed

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(makeState());

		expect(mockSchedulerExecute).toHaveBeenCalled();
		expect(result.response?.type).toBe("text");
	});

	it("confirm callback round-trip: creates pending command, then confirms and sends to scheduler", async () => {
		// Step A: Create pending command
		mockInvoke.mockResolvedValueOnce(mutatingResult);

		const createdRow = {
			id: "cmd-rt",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "our lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "telegram:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		const pendingConfRow = { ...createdRow, status: "pending_confirmation", version: 2 };
		mockCreatePendingCommand.mockResolvedValue(createdRow);
		mockTransitionStatus.mockResolvedValue(pendingConfRow);

		const graph = createConversationGraph(makeConfig());
		const result1 = await graph.invoke(makeState());
		expect(result1.response?.type).toBe("confirmation_prompt");

		// Step B: Confirm callback
		vi.clearAllMocks();
		mockGetPreferences.mockResolvedValue({
			language: "en",
			confirmationMode: "explicit",
			timezone: "UTC",
		});
		mockGetDeliveryRouting.mockResolvedValue({
			connectorType: "telegram",
			connectorRoutingId: "chat-1",
		});
		mockDeliveryDeliver.mockResolvedValue({ deliveryId: "del-1", status: "delivered" });
		mockInsertTurnSummary.mockResolvedValue({});
		mockRedactString.mockImplementation((s: string) => s);

		const confirmResult: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Done! Note created.",
			commandType: "create_note",
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};
		mockInvoke.mockResolvedValueOnce(confirmResult);

		mockGetActivePendingCommandForUser.mockResolvedValue(pendingConfRow);
		const confirmedRow = {
			...pendingConfRow,
			status: "confirmed",
			version: 3,
			confirmedAt: new Date(),
		};
		mockGetPendingCommand.mockResolvedValue(pendingConfRow);
		mockTransitionStatus.mockResolvedValue(confirmedRow);
		mockSchedulerExecute.mockResolvedValue({ executionId: "exec-1", status: "queued" });

		const graph2 = createConversationGraph(makeConfig());
		const result2 = await graph2.invoke(
			makeState({
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:cb:101",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-rt:2",
				},
			}),
		);

		expect(mockSchedulerExecute).toHaveBeenCalled();
		expect(result2.response?.type).toBe("text");
	});

	it("cancel callback round-trip: cancels command without calling scheduler", async () => {
		const cancelResult: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Command cancelled.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};
		mockInvoke.mockResolvedValueOnce(cancelResult);

		const pendingRow = {
			id: "cmd-cancel",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "our lunch" },
			status: "pending_confirmation",
			version: 2,
			sourceMessageRef: "telegram:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockGetActivePendingCommandForUser.mockResolvedValue(pendingRow);
		mockGetPendingCommand.mockResolvedValue(pendingRow);
		mockTransitionStatus.mockResolvedValue({
			...pendingRow,
			status: "cancelled",
			version: 3,
		});

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(
			makeState({
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:cb:101",
					correlationId: "corr-123",
					action: "cancel",
					data: "cmd-cancel:2",
				},
			}),
		);

		expect(mockSchedulerExecute).not.toHaveBeenCalled();
		expect(result.response?.type).toBe("text");
	});

	it("edit callback round-trip: transitions to draft and prompts for changes", async () => {
		const editResult: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "What would you like to change?",
			commandType: "create_note",
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};
		mockInvoke.mockResolvedValueOnce(editResult);

		const pendingRow = {
			id: "cmd-edit",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "our lunch" },
			status: "pending_confirmation",
			version: 2,
			sourceMessageRef: "telegram:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockGetActivePendingCommandForUser.mockResolvedValue(pendingRow);
		mockGetPendingCommand.mockResolvedValue(pendingRow);
		mockTransitionStatus.mockResolvedValue({
			...pendingRow,
			status: "draft",
			version: 3,
		});

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(
			makeState({
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:cb:101",
					correlationId: "corr-123",
					action: "edit",
					data: "cmd-edit:2",
				},
			}),
		);

		expect(result.response?.type).toBe("text");
	});

	it("stale version rejection: callback with wrong version produces error response", async () => {
		const confirmResult: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Confirming.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};
		mockInvoke.mockResolvedValueOnce(confirmResult);

		const pendingRow = {
			id: "cmd-stale",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "our lunch" },
			status: "pending_confirmation",
			version: 3,
			sourceMessageRef: "telegram:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockGetActivePendingCommandForUser.mockResolvedValue(pendingRow);

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(
			makeState({
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:cb:101",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-stale:1", // version 1, but active is version 3
				},
			}),
		);

		expect(result.response?.type).toBe("error");
		expect(result.response?.text).toContain("version");
	});

	it("read-only query bypasses scheduler, delivers via delivery", async () => {
		const readResult: IntentClassificationResult = {
			intent: "read_query",
			detectedLanguage: "en",
			userFacingText: "Jane's birthday is March 15th.",
			commandType: "query_birthday",
			contactRef: "Jane",
			commandPayload: { contactId: 42 },
			confidence: 0.92,
		};
		mockInvoke.mockResolvedValueOnce(readResult);

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(makeState());

		expect(mockSchedulerExecute).not.toHaveBeenCalled();
		expect(mockDeliveryDeliver).toHaveBeenCalled();
		expect(result.response?.type).toBe("text");
		expect(result.response?.text).toBe("Jane's birthday is March 15th.");
	});

	it("out-of-scope rejection: no pending command, no scheduler, delivery called", async () => {
		const outOfScopeResult: IntentClassificationResult = {
			intent: "out_of_scope",
			detectedLanguage: "en",
			userFacingText: "I can only help with Monica CRM tasks.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.95,
		};
		mockInvoke.mockResolvedValueOnce(outOfScopeResult);

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(makeState());

		expect(mockCreatePendingCommand).not.toHaveBeenCalled();
		expect(mockSchedulerExecute).not.toHaveBeenCalled();
		expect(mockDeliveryDeliver).toHaveBeenCalled();
		expect(result.response?.type).toBe("text");
	});

	it("clarification -> resolution -> confirm: three-step flow", async () => {
		// Step A: Initial request needs clarification (draft created)
		const needsClarResult: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Which contact should I add the note to?",
			commandType: "create_note",
			contactRef: null,
			commandPayload: { body: "lunch notes" },
			confidence: 0.5,
			needsClarification: true,
			clarificationReason: "missing_fields",
		};
		mockInvoke.mockResolvedValueOnce(needsClarResult);

		const draftRow = {
			id: "cmd-3step",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch notes" },
			status: "draft",
			version: 1,
			sourceMessageRef: "telegram:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockCreatePendingCommand.mockResolvedValue(draftRow);

		const graph1 = createConversationGraph(makeConfig());
		const result1 = await graph1.invoke(makeState());
		expect(result1.response?.type).toBe("text"); // clarification question
		expect(result1.activePendingCommand).toBeTruthy();
		expect(result1.activePendingCommand?.status).toBe("draft");

		// Step B: User provides clarification (draft updated, transitions to pending_confirmation)
		vi.clearAllMocks();
		mockGetPreferences.mockResolvedValue({
			language: "en",
			confirmationMode: "explicit",
			timezone: "UTC",
		});
		mockGetDeliveryRouting.mockResolvedValue({
			connectorType: "telegram",
			connectorRoutingId: "chat-1",
		});
		mockDeliveryDeliver.mockResolvedValue({ deliveryId: "del-1", status: "delivered" });
		mockInsertTurnSummary.mockResolvedValue({});
		mockRedactString.mockImplementation((s: string) => s);

		const resolvedResult: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "I'll create a note for Jane about lunch.",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { contactId: 42, body: "lunch notes" },
			confidence: 0.85,
			needsClarification: false,
		};
		mockInvoke.mockResolvedValueOnce(resolvedResult);

		mockGetActivePendingCommandForUser.mockResolvedValue(draftRow);
		const updatedDraftRow = {
			...draftRow,
			payload: { type: "create_note", contactId: 42, body: "lunch notes" },
			version: 2,
		};
		mockUpdateDraftPayload.mockResolvedValue(updatedDraftRow);
		const pendingConfRow = { ...updatedDraftRow, status: "pending_confirmation", version: 3 };
		mockTransitionStatus.mockResolvedValue(pendingConfRow);

		const graph2 = createConversationGraph(makeConfig());
		const result2 = await graph2.invoke(
			makeState({
				inboundEvent: {
					type: "text_message" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:msg:457",
					correlationId: "corr-123",
					text: "Jane",
				},
			}),
		);
		expect(result2.response?.type).toBe("confirmation_prompt");
		expect(mockUpdateDraftPayload).toHaveBeenCalled();

		// Step C: User confirms
		vi.clearAllMocks();
		mockGetPreferences.mockResolvedValue({
			language: "en",
			confirmationMode: "explicit",
			timezone: "UTC",
		});
		mockGetDeliveryRouting.mockResolvedValue({
			connectorType: "telegram",
			connectorRoutingId: "chat-1",
		});
		mockDeliveryDeliver.mockResolvedValue({ deliveryId: "del-1", status: "delivered" });
		mockInsertTurnSummary.mockResolvedValue({});
		mockRedactString.mockImplementation((s: string) => s);

		const confirmIntent: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Done! Note created.",
			commandType: "create_note",
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};
		mockInvoke.mockResolvedValueOnce(confirmIntent);

		mockGetActivePendingCommandForUser.mockResolvedValue(pendingConfRow);
		const confirmedRow = {
			...pendingConfRow,
			status: "confirmed",
			version: 4,
			confirmedAt: new Date(),
		};
		mockGetPendingCommand.mockResolvedValue(pendingConfRow);
		mockTransitionStatus.mockResolvedValue(confirmedRow);
		mockSchedulerExecute.mockResolvedValue({ executionId: "exec-1", status: "queued" });

		const graph3 = createConversationGraph(makeConfig());
		const result3 = await graph3.invoke(
			makeState({
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:cb:102",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-3step:3",
				},
			}),
		);

		expect(mockSchedulerExecute).toHaveBeenCalled();
		expect(result3.response?.type).toBe("text");
	});
});
