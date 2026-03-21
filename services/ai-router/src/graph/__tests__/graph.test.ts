import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/api", () => ({
	trace: {
		getTracer: () => ({
			startActiveSpan: (_name: string, fn: (span: unknown) => unknown) =>
				fn({ setAttribute: () => {}, end: () => {} }),
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

vi.mock("../../contact-resolution/client.js", () => ({
	fetchContactSummaries: vi.fn(),
}));

import { fetchContactSummaries } from "../../contact-resolution/client.js";
import type { IntentClassificationResult } from "../intent-schemas.js";
import { GraphResponseSchema } from "../state.js";

const mockFetchContactSummaries = vi.mocked(fetchContactSummaries);

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
const mockUpdateNarrowingContext = vi.fn().mockResolvedValue({});
const mockClearNarrowingContext = vi.fn().mockResolvedValue({});
const mockSchedulerExecute = vi.fn().mockResolvedValue({ executionId: "exec-1", status: "queued" });
const mockDeliveryDeliver = vi.fn().mockResolvedValue({ deliveryId: "del-1", status: "delivered" });
const mockGetDeliveryRouting = vi
	.fn()
	.mockResolvedValue({ connectorType: "telegram", connectorRoutingId: "chat-1" });
const mockGetPreferences = vi
	.fn()
	.mockResolvedValue({ language: "en", confirmationMode: "explicit", timezone: "UTC" });

const mockMonicaIntegrationClient = { fetch: vi.fn() } as any;

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
		updateNarrowingContext: mockUpdateNarrowingContext,
		clearNarrowingContext: mockClearNarrowingContext,
		schedulerClient: { execute: mockSchedulerExecute },
		deliveryClient: { deliver: mockDeliveryDeliver },
		userManagementClient: {
			getDeliveryRouting: mockGetDeliveryRouting,
			getPreferences: mockGetPreferences,
		},
		monicaIntegrationClient: mockMonicaIntegrationClient,
	};
}

describe("createConversationGraph", () => {
	/** Default contact summaries for resolution. Jane (contactId 42) matches the mutatingResult fixture. */
	const defaultSummaries = [
		{
			contactId: 42,
			displayName: "Jane",
			aliases: ["Jane"],
			relationshipLabels: ["friend"],
			importantDates: [],
			lastInteractionAt: null,
		},
	];

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
		mockUpdateNarrowingContext.mockReset().mockResolvedValue({});
		mockClearNarrowingContext.mockReset().mockResolvedValue({});
		mockSchedulerExecute.mockReset().mockResolvedValue({ executionId: "exec-1", status: "queued" });
		mockDeliveryDeliver.mockReset().mockResolvedValue({ deliveryId: "del-1", status: "delivered" });
		mockGetDeliveryRouting
			.mockReset()
			.mockResolvedValue({ connectorType: "telegram", connectorRoutingId: "chat-1" });
		mockGetPreferences
			.mockReset()
			.mockResolvedValue({ language: "en", confirmationMode: "explicit", timezone: "UTC" });
		mockFetchContactSummaries.mockReset().mockResolvedValue(defaultSummaries);
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

	it("sets intentClassification in graph state (with contact resolution applied)", async () => {
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

		// After contact resolution, the classification should have contactId injected
		// and needsClarification set to false
		expect(result.intentClassification?.intent).toBe("mutating_command");
		expect(result.intentClassification?.contactRef).toBe("Jane");
		expect(result.intentClassification?.commandPayload).toEqual({
			contactId: 42,
			body: "our lunch",
		});
		expect(result.intentClassification?.needsClarification).toBe(false);
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

	// --- Progressive contact narrowing integration tests ---

	it("9a: narrowing initiation - 8 candidates triggers text clarification", async () => {
		// 8 contacts matching "mom" via kinship
		const summaries = Array.from({ length: 8 }, (_, i) => ({
			contactId: i + 1,
			displayName: `Parent Contact ${i + 1}`,
			aliases: [`Alias${i + 1}`],
			relationshipLabels: ["parent"],
			importantDates: [],
			lastInteractionAt: null,
		}));
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const narrowingInitResult: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll add a note to mom.",
			commandType: "create_note",
			contactRef: "mom",
			commandPayload: { body: "went to park" },
			confidence: 0.85,
			needsClarification: true, // resolveContactRef will override
		};
		mockInvoke.mockResolvedValueOnce(narrowingInitResult);

		const createdRow = {
			id: "cmd-narrow",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "went to park" },
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
		mockCreatePendingCommand.mockResolvedValue(createdRow);
		mockUpdateNarrowingContext.mockResolvedValue({ ...createdRow, version: 2 });

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(makeState());

		// Should produce a text response (not disambiguation_prompt) asking for name
		expect(result.response?.type).toBe("text");
		expect(result.response?.text).toContain("8 contacts");
		// Should have narrowing context set
		expect(result.narrowingContext).not.toBeNull();
		expect(result.narrowingContext?.round).toBe(0);
		expect(result.narrowingContext?.narrowingCandidateIds).toHaveLength(8);
	});

	it("9b: narrowing continuation - clarification narrows to 2 -> buttons", async () => {
		// Pool of 8, user says "Elena" which matches 2
		const summaries = [
			{
				contactId: 1,
				displayName: "Elena Yuryevna",
				aliases: ["Elena", "Yuryevna"],
				relationshipLabels: ["parent"],
				importantDates: [],
				lastInteractionAt: null,
			},
			{
				contactId: 2,
				displayName: "Maria Petrova",
				aliases: ["Maria", "Petrova"],
				relationshipLabels: ["parent"],
				importantDates: [],
				lastInteractionAt: null,
			},
			{
				contactId: 3,
				displayName: "Elena Smirnova",
				aliases: ["Elena", "Smirnova"],
				relationshipLabels: ["parent"],
				importantDates: [],
				lastInteractionAt: null,
			},
			...Array.from({ length: 5 }, (_, i) => ({
				contactId: i + 4,
				displayName: `Other Contact ${i + 4}`,
				aliases: [`Other${i + 4}`],
				relationshipLabels: ["parent"],
				importantDates: [],
				lastInteractionAt: null,
			})),
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const clarificationResult: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Elena",
			commandType: "create_note",
			contactRef: "Elena",
			commandPayload: { body: "went to park" },
			confidence: 0.8,
			needsClarification: true,
		};
		mockInvoke.mockResolvedValueOnce(clarificationResult);

		// Active draft command with narrowing context
		const draftRow = {
			id: "cmd-narrow-2",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "went to park" },
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
			narrowingContext: {
				originalContactRef: "mom",
				clarifications: [],
				round: 0,
				narrowingCandidateIds: [1, 2, 3, 4, 5, 6, 7, 8],
			},
		};
		mockGetActivePendingCommandForUser.mockResolvedValue(draftRow);
		mockUpdateDraftPayload.mockResolvedValue({ ...draftRow, version: 2 });
		mockUpdateNarrowingContext.mockResolvedValue({ ...draftRow, version: 3 });

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(
			makeState({
				inboundEvent: {
					type: "text_message" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:msg:457",
					correlationId: "corr-123",
					text: "Elena",
				},
			}),
		);

		// Should show disambiguation buttons for the 2 Elena contacts
		expect(result.response?.type).toBe("disambiguation_prompt");
		expect(result.response?.options).toBeDefined();
		expect(result.response?.options?.length).toBe(2);
		// Narrowing context should be cleared
		expect(result.narrowingContext).toBeNull();
	});

	it("9c: pool reaches 0 -> no-match fallback", async () => {
		const summaries = [
			{
				contactId: 1,
				displayName: "Elena Yuryevna",
				aliases: ["Elena", "Yuryevna"],
				relationshipLabels: ["parent"],
				importantDates: [],
				lastInteractionAt: null,
			},
			{
				contactId: 2,
				displayName: "Maria Petrova",
				aliases: ["Maria", "Petrova"],
				relationshipLabels: ["parent"],
				importantDates: [],
				lastInteractionAt: null,
			},
		];
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const clarificationResult: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Xavier",
			commandType: "create_note",
			contactRef: "Xavier",
			commandPayload: { body: "test" },
			confidence: 0.8,
			needsClarification: true,
		};
		mockInvoke.mockResolvedValueOnce(clarificationResult);

		const draftRow = {
			id: "cmd-narrow-3",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "test" },
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
			narrowingContext: {
				originalContactRef: "mom",
				clarifications: [],
				round: 0,
				narrowingCandidateIds: [1, 2],
			},
		};
		mockGetActivePendingCommandForUser.mockResolvedValue(draftRow);
		mockUpdateNarrowingContext.mockResolvedValue({ ...draftRow, version: 2 });

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(
			makeState({
				inboundEvent: {
					type: "text_message" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:msg:457",
					correlationId: "corr-123",
					text: "Xavier",
				},
			}),
		);

		// Should produce text response (no-match fallback)
		expect(result.response?.type).toBe("text");
		expect(result.narrowingContext).toBeNull();
	});

	it("9d: 3-round cap -> forced buttons", async () => {
		// All 8 contacts match "Elena"
		const summaries = Array.from({ length: 8 }, (_, i) => ({
			contactId: i + 1,
			displayName: `Elena Contact${i + 1}`,
			aliases: ["Elena", `Contact${i + 1}`],
			relationshipLabels: ["parent"],
			importantDates: [],
			lastInteractionAt: null,
		}));
		mockFetchContactSummaries.mockResolvedValue(summaries);

		const clarificationResult: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Elena",
			commandType: "create_note",
			contactRef: "Elena",
			commandPayload: { body: "test" },
			confidence: 0.8,
			needsClarification: true,
		};
		mockInvoke.mockResolvedValueOnce(clarificationResult);

		// Round 2 -> next round (2+1=3) hits the cap
		const draftRow = {
			id: "cmd-narrow-4",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "test" },
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
			narrowingContext: {
				originalContactRef: "mom",
				clarifications: ["term1", "term2"],
				round: 2,
				narrowingCandidateIds: [1, 2, 3, 4, 5, 6, 7, 8],
			},
		};
		mockGetActivePendingCommandForUser.mockResolvedValue(draftRow);
		mockUpdateDraftPayload.mockResolvedValue({ ...draftRow, version: 2 });
		mockUpdateNarrowingContext.mockResolvedValue({ ...draftRow, version: 3 });

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(
			makeState({
				inboundEvent: {
					type: "text_message" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:msg:457",
					correlationId: "corr-123",
					text: "Elena",
				},
			}),
		);

		// Should force buttons (disambiguation_prompt) with at most 5 options
		expect(result.response?.type).toBe("disambiguation_prompt");
		expect(result.response?.options).toBeDefined();
		expect(result.response?.options?.length).toBeLessThanOrEqual(5);
		// Narrowing context should be cleared
		expect(result.narrowingContext).toBeNull();
	});
});
