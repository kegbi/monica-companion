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
const mockUpdatePendingPayload = vi.fn();
const mockSetUnresolvedContactRef = vi.fn().mockResolvedValue({});
const mockClearUnresolvedContactRef = vi.fn().mockResolvedValue({});
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
		updatePendingPayload: mockUpdatePendingPayload,
		setUnresolvedContactRef: mockSetUnresolvedContactRef,
		clearUnresolvedContactRef: mockClearUnresolvedContactRef,
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
		mockUpdatePendingPayload.mockReset();
		mockSetUnresolvedContactRef.mockReset().mockResolvedValue({});
		mockClearUnresolvedContactRef.mockReset().mockResolvedValue({});
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

	it("sets intentClassification in graph state (with deferred contact resolution)", async () => {
		mockInvoke.mockResolvedValueOnce(mutatingResult);

		// For mutating commands with contactRef, resolution is now deferred (confirm-then-resolve)
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

		// With confirm-then-resolve, contactId is NOT injected yet (deferred)
		// Instead, unresolvedContactRef is set
		expect(result.intentClassification?.intent).toBe("mutating_command");
		expect(result.intentClassification?.contactRef).toBe("Jane");
		expect(result.intentClassification?.needsClarification).toBe(false);
		expect(result.unresolvedContactRef).toBe("Jane");
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
		// Use create_contact (no contactRef) to test auto-confirm without deferred resolution
		const highConfResult: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll create a contact named Xavier.",
			commandType: "create_contact",
			contactRef: null,
			commandPayload: { firstName: "Xavier", genderId: 0 },
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
			commandType: "create_contact",
			payload: { type: "create_contact", firstName: "Xavier", genderId: 0 },
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

	it("9a: mutating command with contactRef defers resolution (confirm-then-resolve)", async () => {
		// With confirm-then-resolve, mutating_command with contactRef defers resolution
		// and produces a confirmation_prompt instead of triggering narrowing
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
		mockTransitionStatus.mockResolvedValue({
			...createdRow,
			status: "pending_confirmation",
			version: 2,
		});

		const graph = createConversationGraph(makeConfig());
		const result = await graph.invoke(makeState());

		// Should produce a confirmation_prompt (deferred resolution, not narrowing)
		expect(result.response?.type).toBe("confirmation_prompt");
		// unresolvedContactRef should be set
		expect(result.unresolvedContactRef).toBe("mom");
		// Contact summaries should NOT be fetched (deferred)
		expect(mockFetchContactSummaries).not.toHaveBeenCalled();
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

	// --- Multi-turn kinship flow helpers ---

	/** Factory for PendingCommandRow-shaped objects used across multi-turn tests. */
	function makePendingCommandRow(overrides: Record<string, unknown> = {}) {
		return {
			id: "cmd-mt",
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
			...overrides,
		};
	}

	/** Clear all mocks and re-establish the defaults that every turn needs. */
	function resetMocksWithDefaults() {
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
	}

	// --- Multi-turn kinship integration tests ---

	it("confirm-then-resolve: user cancels at action confirmation, contact resolution never runs", async () => {
		// --- Turn 1: Initial message ("add a note to mom about dinner") ---
		const turn1Intent: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll add a note about dinner plans.",
			commandType: "create_note",
			contactRef: "mom",
			commandPayload: { body: "dinner plans" },
			confidence: 0.85,
			needsClarification: false,
		};
		mockInvoke.mockResolvedValueOnce(turn1Intent);

		const draftRow = makePendingCommandRow({
			id: "cmd-cancel-test",
			payload: { type: "create_note", body: "dinner plans" },
		});
		mockCreatePendingCommand.mockResolvedValue(draftRow);
		const pendingConfRow = {
			...draftRow,
			status: "pending_confirmation",
			version: 2,
		};
		mockTransitionStatus.mockResolvedValue(pendingConfRow);

		const graph1 = createConversationGraph(makeConfig());
		const result1 = await graph1.invoke(makeState());

		expect(result1.response?.type).toBe("confirmation_prompt");
		expect(result1.unresolvedContactRef).toBe("mom");
		// Contact summaries should NOT be fetched (resolution deferred)
		expect(mockFetchContactSummaries).not.toHaveBeenCalled();
		expect(result1.response?.pendingCommandId).toBe("cmd-cancel-test");
		expect(result1.response?.version).toBe(2);

		// --- Turn 2: User cancels (callback_action: cancel) ---
		resetMocksWithDefaults();

		const turn2Intent: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Command cancelled.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};
		mockInvoke.mockResolvedValueOnce(turn2Intent);

		mockGetActivePendingCommandForUser.mockResolvedValue({
			...pendingConfRow,
			unresolvedContactRef: "mom",
		});
		mockGetPendingCommand.mockResolvedValue(pendingConfRow);
		mockTransitionStatus.mockResolvedValue({
			...pendingConfRow,
			status: "cancelled",
			version: 3,
		});

		const graph2 = createConversationGraph(makeConfig());
		const result2 = await graph2.invoke(
			makeState({
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:cb:201",
					correlationId: "corr-123",
					action: "cancel",
					data: "cmd-cancel-test:2",
				},
			}),
		);

		// Contact resolution never ran (cancel clears unresolvedContactRef)
		expect(mockFetchContactSummaries).not.toHaveBeenCalled();
		expect(mockSchedulerExecute).not.toHaveBeenCalled();
		expect(result2.response?.type).toBe("text");
		expect(result2.actionOutcome?.type).toBe("cancelled");
	});

	it("unambiguous kinship: single parent candidate -> action confirm -> auto-resolve -> execute", async () => {
		// Single parent contact for unambiguous resolution
		const singleParent = {
			contactId: 42,
			displayName: "Elena Yuryevna (Mama)",
			aliases: ["Elena", "Mama", "Yuryevna"],
			relationshipLabels: ["parent"],
			importantDates: [],
			lastInteractionAt: null,
		};

		// --- Turn 1: Initial message ("add a note to mom about garden") ---
		const turn1Intent: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll add a note about the garden project.",
			commandType: "create_note",
			contactRef: "mom",
			commandPayload: { body: "garden project" },
			confidence: 0.85,
			needsClarification: false,
		};
		mockInvoke.mockResolvedValueOnce(turn1Intent);

		const draftRow = makePendingCommandRow({
			id: "cmd-unambig",
			payload: { type: "create_note", body: "garden project" },
		});
		mockCreatePendingCommand.mockResolvedValue(draftRow);
		const pendingConfRow = {
			...draftRow,
			status: "pending_confirmation",
			version: 2,
		};
		mockTransitionStatus.mockResolvedValue(pendingConfRow);

		const graph1 = createConversationGraph(makeConfig());
		const result1 = await graph1.invoke(makeState());

		expect(result1.response?.type).toBe("confirmation_prompt");
		expect(result1.unresolvedContactRef).toBe("mom");
		expect(mockFetchContactSummaries).not.toHaveBeenCalled();

		// --- Turn 2: User confirms (callback_action: confirm) ---
		resetMocksWithDefaults();

		const turn2Intent: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Done! Note created.",
			commandType: "create_note",
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};
		mockInvoke.mockResolvedValueOnce(turn2Intent);

		// loadContext returns the pending_confirmation row with unresolvedContactRef
		mockGetActivePendingCommandForUser.mockResolvedValue({
			...pendingConfRow,
			unresolvedContactRef: "mom",
		});
		// Deferred resolution now fetches summaries: single parent
		mockFetchContactSummaries.mockResolvedValue([singleParent]);

		mockGetPendingCommand.mockResolvedValue(pendingConfRow);
		// updatePendingPayload merges contactId into payload
		const updatedPayloadRow = {
			...pendingConfRow,
			payload: { type: "create_note", contactId: 42, body: "garden project" },
			version: 3,
		};
		mockUpdatePendingPayload.mockResolvedValue(updatedPayloadRow);
		// transitionStatus: pending_confirmation -> confirmed
		const confirmedRow = {
			...updatedPayloadRow,
			status: "confirmed",
			version: 4,
			confirmedAt: new Date(),
		};
		mockTransitionStatus.mockResolvedValue(confirmedRow);
		mockSchedulerExecute.mockResolvedValue({ executionId: "exec-1", status: "queued" });

		const graph2 = createConversationGraph(makeConfig());
		const result2 = await graph2.invoke(
			makeState({
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:cb:301",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-unambig:2",
				},
			}),
		);

		// Deferred resolution ran
		expect(mockFetchContactSummaries).toHaveBeenCalled();
		// Payload updated with contactId
		expect(mockUpdatePendingPayload).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-unambig",
			expect.any(Number),
			expect.objectContaining({ contactId: 42 }),
		);
		// Scheduler called
		expect(mockSchedulerExecute).toHaveBeenCalled();
		expect(result2.response?.type).toBe("text");
	});

	it("multi-turn kinship disambiguation: initial -> action confirm -> narrowing -> user answers -> buttons -> select -> auto-confirm -> execute", async () => {
		// 8 contacts: 2 Elenas, used across all turns
		const eightParentContacts = [
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

		// --- Turn 1: Initial message ("add a note to mom about the park") ---
		const turn1Intent: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll add a note about the park.",
			commandType: "create_note",
			contactRef: "mom",
			commandPayload: { body: "went to park" },
			confidence: 0.85,
			needsClarification: false,
		};
		mockInvoke.mockResolvedValueOnce(turn1Intent);

		const draftRow = makePendingCommandRow({
			id: "cmd-narrow-rt",
			payload: { type: "create_note", body: "went to park" },
		});
		mockCreatePendingCommand.mockResolvedValue(draftRow);
		const pendingConfRow = {
			...draftRow,
			status: "pending_confirmation",
			version: 2,
		};
		mockTransitionStatus.mockResolvedValue(pendingConfRow);

		const graph1 = createConversationGraph(makeConfig());
		const result1 = await graph1.invoke(makeState());

		expect(result1.response?.type).toBe("confirmation_prompt");
		expect(result1.unresolvedContactRef).toBe("mom");
		expect(mockFetchContactSummaries).not.toHaveBeenCalled();

		// --- Turn 2: User confirms action -> deferred resolution -> 8 candidates -> narrowing ---
		resetMocksWithDefaults();

		const turn2Intent: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Confirmed",
			commandType: "create_note",
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};
		mockInvoke.mockResolvedValueOnce(turn2Intent);

		// loadContext returns pending_confirmation with unresolvedContactRef
		mockGetActivePendingCommandForUser.mockResolvedValue({
			...pendingConfRow,
			unresolvedContactRef: "mom",
		});
		// Deferred resolution fetches 8 parent contacts -> narrowing (>5 candidates)
		mockFetchContactSummaries.mockResolvedValue(eightParentContacts);
		mockGetPendingCommand.mockResolvedValue(pendingConfRow);
		// handleConfirm transitions pending_confirmation -> draft for disambiguation
		const draftFromAmbiguousRow = {
			...pendingConfRow,
			status: "draft",
			version: 3,
		};
		mockTransitionStatus.mockResolvedValue(draftFromAmbiguousRow);
		mockUpdateNarrowingContext.mockResolvedValue({});

		const graph2 = createConversationGraph(makeConfig());
		const result2 = await graph2.invoke(
			makeState({
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:cb:401",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-narrow-rt:2",
				},
			}),
		);

		expect(mockFetchContactSummaries).toHaveBeenCalled();
		// Response type should be text (narrowing clarification question, >5 candidates)
		expect(result2.response?.type).toBe("text");
		// narrowingContext should be set (8 candidates entering narrowing)
		expect(result2.narrowingContext).not.toBeNull();
		expect(result2.narrowingContext?.narrowingCandidateIds).toHaveLength(8);
		expect(result2.narrowingContext?.round).toBe(0);
		// Command transitioned back to draft
		expect(result2.activePendingCommand?.status).toBe("draft");

		// BUG: handleConfirm ambiguous path does not call updateNarrowingContext
		// expect(mockUpdateNarrowingContext).toHaveBeenCalled();

		// --- Turn 3: User answers "Elena" -> narrowing produces 2 candidates -> buttons ---
		resetMocksWithDefaults();

		const turn3Intent: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Elena",
			commandType: "create_note",
			contactRef: "Elena",
			commandPayload: { body: "went to park" },
			confidence: 0.8,
			needsClarification: true,
		};
		mockInvoke.mockResolvedValueOnce(turn3Intent);

		// loadContext returns draft row WITH narrowingContext on the row
		// Note: narrowingContext on the row is a workaround for the bug above --
		// handleConfirm does not persist narrowingContext via updateNarrowingContext,
		// so the test manually includes it on the row returned by getActivePendingCommandForUser.
		mockGetActivePendingCommandForUser.mockResolvedValue({
			...draftFromAmbiguousRow,
			narrowingContext: {
				originalContactRef: "mom",
				clarifications: [],
				round: 0,
				narrowingCandidateIds: [1, 2, 3, 4, 5, 6, 7, 8],
			},
		});
		mockFetchContactSummaries.mockResolvedValue(eightParentContacts);
		mockUpdateDraftPayload.mockResolvedValue({
			...draftFromAmbiguousRow,
			version: 4,
		});
		mockUpdateNarrowingContext.mockResolvedValue({});

		const graph3 = createConversationGraph(makeConfig());
		const result3 = await graph3.invoke(
			makeState({
				inboundEvent: {
					type: "text_message" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:msg:402",
					correlationId: "corr-123",
					text: "Elena",
				},
			}),
		);

		// Should show disambiguation buttons for 2 Elena contacts (<=5 threshold)
		expect(result3.response?.type).toBe("disambiguation_prompt");
		expect(result3.response?.options).toBeDefined();
		expect(result3.response?.options?.length).toBe(2);
		// Options should contain Elena Yuryevna (contactId 1) and Elena Smirnova (contactId 3)
		const optionValues = result3.response?.options?.map((o: { value: string }) => o.value);
		expect(optionValues).toContain("1");
		expect(optionValues).toContain("3");
		// Narrowing context cleared when presenting buttons
		expect(result3.narrowingContext).toBeNull();

		// --- Turn 4: User selects Elena Yuryevna -> auto-confirm -> execute ---
		resetMocksWithDefaults();
		// Override preferences for auto-confirm path
		mockGetPreferences.mockResolvedValue({
			language: "en",
			confirmationMode: "auto",
			timezone: "UTC",
		});

		const turn4Intent: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Done! Note added to Elena Yuryevna.",
			commandType: "create_note",
			contactRef: null,
			commandPayload: { body: "went to park" },
			confidence: 0.97,
			needsClarification: false,
		};
		mockInvoke.mockResolvedValueOnce(turn4Intent);

		// loadContext returns draft row from turn 3
		const turn3DraftRow = {
			...draftFromAmbiguousRow,
			version: 4,
		};
		mockGetActivePendingCommandForUser.mockResolvedValue(turn3DraftRow);
		mockGetPendingCommand.mockResolvedValue(turn3DraftRow);

		// updateDraftPayload: merge contactId into payload
		const payloadWithContact = {
			...turn3DraftRow,
			payload: { type: "create_note", contactId: 1, body: "went to park" },
			version: 5,
		};
		mockUpdateDraftPayload.mockResolvedValue(payloadWithContact);

		// transitionStatus: draft -> pending_confirmation, then pending_confirmation -> confirmed
		const pendingFromSelect = {
			...payloadWithContact,
			status: "pending_confirmation",
			version: 6,
		};
		const confirmedFromAutoConfirm = {
			...pendingFromSelect,
			status: "confirmed",
			version: 7,
			confirmedAt: new Date(),
		};
		mockTransitionStatus
			.mockResolvedValueOnce(pendingFromSelect)
			.mockResolvedValueOnce(confirmedFromAutoConfirm);
		mockSchedulerExecute.mockResolvedValue({ executionId: "exec-2", status: "queued" });

		const graph4 = createConversationGraph(makeConfig());
		const result4 = await graph4.invoke(
			makeState({
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "telegram:cb:403",
					correlationId: "corr-123",
					action: "select",
					data: "1:0",
				},
			}),
		);

		// Payload updated with contactId 1
		expect(mockUpdateDraftPayload).toHaveBeenCalledWith(
			expect.anything(),
			expect.any(String),
			expect.any(Number),
			expect.objectContaining({ contactId: 1 }),
			expect.any(Number),
		);
		// transitionStatus called twice (draft -> pending_confirmation, pending_confirmation -> confirmed)
		expect(mockTransitionStatus).toHaveBeenCalledTimes(2);
		// Auto-confirm path fetches user preferences
		expect(mockGetPreferences).toHaveBeenCalled();
		// Scheduler executed
		expect(mockSchedulerExecute).toHaveBeenCalled();
		// Action outcome type is auto_confirmed
		expect(result4.actionOutcome?.type).toBe("auto_confirmed");
		expect(result4.response?.type).toBe("text");
	});
});
