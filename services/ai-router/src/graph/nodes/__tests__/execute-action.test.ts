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

import type { IntentClassificationResult } from "../../intent-schemas.js";
import type { PendingCommandRef } from "../../state.js";
import { createExecuteActionNode, type ExecuteActionDeps } from "../execute-action.js";

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
			sourceRef: "tg:msg:456",
			correlationId: "corr-123",
			text: "Add a note to Jane about lunch",
		},
		recentTurns: [],
		activePendingCommand: null,
		contactResolution: null,
		contactSummariesCache: null,
		userPreferences: null,
		intentClassification,
		actionOutcome: null,
		narrowingContext: null,
		unresolvedContactRef: null,
		response: null,
		...overrides,
	};
}

const mockCreatePendingCommand = vi.fn();
const mockTransitionStatus = vi.fn();
const mockGetPendingCommand = vi.fn();
const mockUpdateDraftPayload = vi.fn();
const mockUpdateNarrowingContext = vi.fn();
const mockClearNarrowingContext = vi.fn();
const mockSchedulerExecute = vi.fn();
const mockGetPreferences = vi.fn();
const mockUpdatePendingPayload = vi.fn();
const mockSetUnresolvedContactRef = vi.fn();
const mockClearUnresolvedContactRef = vi.fn();

function makeDeps(overrides: Partial<ExecuteActionDeps> = {}): ExecuteActionDeps {
	return {
		db: {} as any,
		pendingCommandTtlMinutes: 30,
		autoConfirmConfidenceThreshold: 0.95,
		createPendingCommand: mockCreatePendingCommand,
		transitionStatus: mockTransitionStatus,
		getPendingCommand: mockGetPendingCommand,
		updateDraftPayload: mockUpdateDraftPayload,
		updateNarrowingContext: mockUpdateNarrowingContext,
		clearNarrowingContext: mockClearNarrowingContext,
		updatePendingPayload: mockUpdatePendingPayload,
		setUnresolvedContactRef: mockSetUnresolvedContactRef,
		clearUnresolvedContactRef: mockClearUnresolvedContactRef,
		buildConfirmedPayload: (record: any) => ({
			pendingCommandId: record.id,
			userId: record.userId,
			commandType: record.commandType,
			payload: record.payload,
			idempotencyKey: `${record.id}:v${record.version}`,
			correlationId: record.correlationId,
			confirmedAt: new Date().toISOString(),
		}),
		schedulerClient: { execute: mockSchedulerExecute },
		userManagementClient: { getPreferences: mockGetPreferences, getDeliveryRouting: vi.fn() },
		...overrides,
	};
}

const mutatingClassification: IntentClassificationResult = {
	intent: "mutating_command",
	detectedLanguage: "en",
	userFacingText: "I'll create a note for Jane about lunch.",
	commandType: "create_note",
	contactRef: "Jane",
	commandPayload: { contactId: 42, body: "lunch" },
	confidence: 0.85,
};

const readQueryClassification: IntentClassificationResult = {
	intent: "read_query",
	detectedLanguage: "en",
	userFacingText: "Jane's birthday is March 15th.",
	commandType: "query_birthday",
	contactRef: "Jane",
	commandPayload: {},
	confidence: 0.92,
};

const greetingClassification: IntentClassificationResult = {
	intent: "greeting",
	detectedLanguage: "en",
	userFacingText: "Hello! How can I help?",
	commandType: null,
	contactRef: null,
	commandPayload: null,
	confidence: 0.99,
};

const outOfScopeClassification: IntentClassificationResult = {
	intent: "out_of_scope",
	detectedLanguage: "en",
	userFacingText: "I can only help with Monica CRM tasks.",
	commandType: null,
	contactRef: null,
	commandPayload: null,
	confidence: 0.95,
};

describe("executeActionNode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetPreferences.mockResolvedValue({
			language: "en",
			confirmationMode: "explicit",
			timezone: "UTC",
		});
	});

	// --- Passthrough intents ---

	it("returns passthrough for greeting intent", async () => {
		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(greetingClassification));
		expect(update.actionOutcome).toEqual({ type: "passthrough" });
	});

	it("returns passthrough for out_of_scope intent", async () => {
		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(outOfScopeClassification));
		expect(update.actionOutcome).toEqual({ type: "passthrough" });
	});

	it("returns passthrough when intentClassification is null", async () => {
		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(null));
		expect(update.actionOutcome).toEqual({ type: "passthrough" });
	});

	// --- Read-only queries ---

	it("returns read_through for read_query intent", async () => {
		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(readQueryClassification));
		expect(update.actionOutcome).toEqual({ type: "read_through" });
	});

	// --- Mutating commands: create pending command ---

	it("creates pending command for mutating_command intent", async () => {
		const createdRow = {
			id: "cmd-1",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
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

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(mutatingClassification));

		expect(mockCreatePendingCommand).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				userId: "550e8400-e29b-41d4-a716-446655440000",
				commandType: "create_note",
				sourceMessageRef: "tg:msg:456",
				correlationId: "corr-123",
			}),
		);
		expect(mockTransitionStatus).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-1",
			1,
			"draft",
			"pending_confirmation",
		);
		expect(update.actionOutcome).toEqual({
			type: "pending_created",
			pendingCommandId: "cmd-1",
			version: 2,
		});
	});

	// --- Mutating commands with clarification needed ---

	it("creates draft pending command when clarification needed", async () => {
		const clarificationClassification: IntentClassificationResult = {
			...mutatingClassification,
			needsClarification: true,
			clarificationReason: "missing_fields",
			confidence: 0.5,
		};

		const createdRow = {
			id: "cmd-2",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
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

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(clarificationClassification));

		expect(mockCreatePendingCommand).toHaveBeenCalled();
		// Should NOT transition to pending_confirmation when clarification is needed
		expect(mockTransitionStatus).not.toHaveBeenCalled();
		expect(update.actionOutcome).toEqual({ type: "edit_draft" });
	});

	// --- Auto-confirmation ---

	it("auto-confirms when user preferences allow and confidence exceeds threshold", async () => {
		mockGetPreferences.mockResolvedValue({
			language: "en",
			confirmationMode: "auto",
			timezone: "UTC",
		});

		const highConfidenceClassification: IntentClassificationResult = {
			...mutatingClassification,
			confidence: 0.97,
		};

		const createdRow = {
			id: "cmd-3",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		const confirmedRow = {
			...createdRow,
			status: "confirmed",
			version: 2,
			confirmedAt: new Date(),
		};

		mockCreatePendingCommand.mockResolvedValue(createdRow);
		mockTransitionStatus
			.mockResolvedValueOnce({ ...createdRow, status: "pending_confirmation", version: 2 })
			.mockResolvedValueOnce(confirmedRow);
		mockSchedulerExecute.mockResolvedValue({ executionId: "exec-1", status: "queued" });

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(highConfidenceClassification));

		expect(update.actionOutcome).toEqual({
			type: "auto_confirmed",
			pendingCommandId: "cmd-3",
		});
		expect(mockSchedulerExecute).toHaveBeenCalled();
	});

	it("does not auto-confirm when confidence below threshold", async () => {
		mockGetPreferences.mockResolvedValue({
			language: "en",
			confirmationMode: "auto",
			timezone: "UTC",
		});

		const createdRow = {
			id: "cmd-4",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
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

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(mutatingClassification)); // confidence 0.85

		expect(update.actionOutcome).toEqual({
			type: "pending_created",
			pendingCommandId: "cmd-4",
			version: 2,
		});
		expect(mockSchedulerExecute).not.toHaveBeenCalled();
	});

	// --- Callback actions: confirm ---

	it("confirms pending command on confirm callback", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-5",
			version: 1,
			status: "pending_confirmation",
			commandType: "create_note",
		};

		const confirmClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Got it, executing now.",
			commandType: "create_note",
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};

		const confirmedRow = {
			id: "cmd-5",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "confirmed",
			version: 2,
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: new Date(),
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockGetPendingCommand.mockResolvedValue({
			...confirmedRow,
			status: "pending_confirmation",
			version: 1,
			confirmedAt: null,
		});
		mockTransitionStatus.mockResolvedValue(confirmedRow);
		mockSchedulerExecute.mockResolvedValue({ executionId: "exec-2", status: "queued" });

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(confirmClassification, {
				activePendingCommand,
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-5:1",
				},
			}),
		);

		expect(update.actionOutcome).toEqual({
			type: "confirmed",
			pendingCommandId: "cmd-5",
		});
		expect(mockSchedulerExecute).toHaveBeenCalled();
	});

	// --- Callback actions: cancel ---

	it("cancels pending command on cancel callback", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-6",
			version: 1,
			status: "pending_confirmation",
			commandType: "create_note",
		};

		const cancelClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Command cancelled.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};

		mockGetPendingCommand.mockResolvedValue({
			id: "cmd-6",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "pending_confirmation",
			version: 1,
		});
		mockTransitionStatus.mockResolvedValue({
			id: "cmd-6",
			status: "cancelled",
			version: 2,
		});

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(cancelClassification, {
				activePendingCommand,
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "cancel",
					data: "cmd-6:1",
				},
			}),
		);

		expect(update.actionOutcome).toEqual({ type: "cancelled" });
	});

	// --- Callback actions: edit ---

	it("transitions to draft on edit callback", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-7",
			version: 1,
			status: "pending_confirmation",
			commandType: "create_note",
		};

		const editClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "What would you like to change?",
			commandType: "create_note",
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};

		mockGetPendingCommand.mockResolvedValue({
			id: "cmd-7",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "pending_confirmation",
			version: 1,
		});
		mockTransitionStatus.mockResolvedValue({
			id: "cmd-7",
			status: "draft",
			version: 2,
		});

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(editClassification, {
				activePendingCommand,
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "edit",
					data: "cmd-7:1",
				},
			}),
		);

		expect(update.actionOutcome).toEqual({ type: "edit_draft" });
	});

	// --- Stale/expired confirmations ---

	it("rejects stale confirmation with version mismatch", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-8",
			version: 2,
			status: "pending_confirmation",
			commandType: "create_note",
		};

		const confirmClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Confirming.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};

		// Callback data has version 1, but active command is version 2
		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(confirmClassification, {
				activePendingCommand,
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-8:1",
				},
			}),
		);

		expect(update.actionOutcome).toEqual({
			type: "stale_rejected",
			reason: expect.stringContaining("version"),
		});
	});

	it("rejects confirmation when pending command not found", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-9",
			version: 1,
			status: "pending_confirmation",
			commandType: "create_note",
		};

		const confirmClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Confirming.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};

		mockGetPendingCommand.mockResolvedValue(null);

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(confirmClassification, {
				activePendingCommand,
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-9:1",
				},
			}),
		);

		expect(update.actionOutcome).toEqual({
			type: "stale_rejected",
			reason: expect.stringContaining("not found"),
		});
	});

	// --- Step 1: Conditional payload validation ---

	it("rejects mutating command with invalid complete payload (missing contactId when needsClarification is false)", async () => {
		// commandPayload is missing contactId which is required for create_note
		const invalidClassification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll create a note about lunch.",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { body: "lunch" }, // missing contactId
			confidence: 0.85,
			needsClarification: false,
		};

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(invalidClassification));

		// Should return passthrough, not create a pending command
		expect(update.actionOutcome).toEqual({ type: "passthrough" });
		expect(mockCreatePendingCommand).not.toHaveBeenCalled();
	});

	it("allows incomplete payload when needsClarification is true (missing contactId for create_note)", async () => {
		const clarificationClassification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Which contact should I add the note to?",
			commandType: "create_note",
			contactRef: null,
			commandPayload: { body: "lunch" }, // missing contactId, but that's ok
			confidence: 0.5,
			needsClarification: true,
			clarificationReason: "missing_fields",
		};

		const createdRow = {
			id: "cmd-val-2",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
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

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(clarificationClassification));

		// Should create a draft pending command despite invalid payload
		expect(mockCreatePendingCommand).toHaveBeenCalled();
		expect(update.actionOutcome).toEqual({ type: "edit_draft" });
	});

	it("accepts valid complete payload and creates pending command (needsClarification false)", async () => {
		// Complete valid payload for create_note
		const validClassification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll create a note for Jane about lunch.",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { contactId: 42, body: "lunch notes" },
			confidence: 0.85,
			needsClarification: false,
		};

		const createdRow = {
			id: "cmd-val-3",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "lunch notes" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
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

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(validClassification));

		expect(mockCreatePendingCommand).toHaveBeenCalled();
		expect(update.actionOutcome).toEqual({
			type: "pending_created",
			pendingCommandId: "cmd-val-3",
			version: 2,
		});
	});

	// --- Step 2: TTL expiry check at callback time ---

	it("rejects callback for command past expiresAt even if status is still pending_confirmation", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-ttl",
			version: 1,
			status: "pending_confirmation",
			commandType: "create_note",
		};

		const callbackClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Confirming.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};

		mockGetPendingCommand.mockResolvedValue({
			id: "cmd-ttl",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 1, body: "lunch" },
			status: "pending_confirmation",
			version: 1,
			expiresAt: new Date(Date.now() - 60000), // expired 1 minute ago
		});

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(callbackClassification, {
				activePendingCommand,
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-ttl:1",
				},
			}),
		);

		expect(update.actionOutcome).toEqual({
			type: "stale_rejected",
			reason: expect.stringContaining("expired"),
		});
	});

	// --- Step 3: Wire updateDraftPayload for clarification responses ---

	it("updates draft payload and transitions to pending_confirmation when clarification resolves the command", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-clar-1",
			version: 1,
			status: "draft",
			commandType: "create_note",
		};

		const clarificationResolvedClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "I'll create a note for Jane about lunch.",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { contactId: 42, body: "lunch" },
			confidence: 0.85,
			needsClarification: false,
		};

		const updatedRow = {
			id: "cmd-clar-1",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "lunch" },
			status: "draft",
			version: 2,
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockUpdateDraftPayload.mockResolvedValue(updatedRow);

		const pendingConfRow = {
			...updatedRow,
			status: "pending_confirmation",
			version: 3,
		};
		mockTransitionStatus.mockResolvedValue(pendingConfRow);

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(clarificationResolvedClassification, { activePendingCommand }),
		);

		expect(mockUpdateDraftPayload).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-clar-1",
			1,
			{ type: "create_note", contactId: 42, body: "lunch" },
			30,
		);
		expect(mockTransitionStatus).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-clar-1",
			2,
			"draft",
			"pending_confirmation",
		);
		expect(update.actionOutcome).toEqual({
			type: "pending_created",
			pendingCommandId: "cmd-clar-1",
			version: 3,
		});
	});

	it("updates draft payload but stays in draft when clarification is still incomplete", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-clar-2",
			version: 1,
			status: "draft",
			commandType: "create_note",
		};

		const stillNeedsClarification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Which contact should I add the note to?",
			commandType: "create_note",
			contactRef: null,
			commandPayload: { body: "lunch" },
			confidence: 0.5,
			needsClarification: true,
			clarificationReason: "missing_fields",
		};

		const updatedRow = {
			id: "cmd-clar-2",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "draft",
			version: 2,
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockUpdateDraftPayload.mockResolvedValue(updatedRow);

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(stillNeedsClarification, { activePendingCommand }));

		expect(mockUpdateDraftPayload).toHaveBeenCalled();
		expect(mockTransitionStatus).not.toHaveBeenCalled();
		expect(update.actionOutcome).toEqual({ type: "edit_draft" });
	});

	it("falls through to passthrough when clarification_response has no active pending command", async () => {
		const clarificationClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Some clarification text.",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { contactId: 42, body: "lunch" },
			confidence: 0.85,
			needsClarification: false,
		};

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(clarificationClassification));

		// No active pending command, so should passthrough
		expect(mockUpdateDraftPayload).not.toHaveBeenCalled();
		expect(update.actionOutcome).toEqual({ type: "passthrough" });
	});

	it("falls through to passthrough when clarification_response has no commandPayload from LLM", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-clar-4",
			version: 1,
			status: "draft",
			commandType: "create_note",
		};

		const noPayloadClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "I'm not sure what you mean.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.6,
		};

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(noPayloadClassification, { activePendingCommand }));

		expect(mockUpdateDraftPayload).not.toHaveBeenCalled();
		expect(update.actionOutcome).toEqual({ type: "passthrough" });
	});

	// --- Existing test (renamed for clarity) ---

	it("rejects confirmation when command has expired", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-10",
			version: 1,
			status: "pending_confirmation",
			commandType: "create_note",
		};

		mockGetPendingCommand.mockResolvedValue({
			id: "cmd-10",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "expired",
			version: 1,
		});

		const confirmClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Confirming.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
		};

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(confirmClassification, {
				activePendingCommand,
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-10:1",
				},
			}),
		);

		expect(update.actionOutcome).toEqual({
			type: "stale_rejected",
			reason: expect.stringContaining("expired"),
		});
	});

	// --- Clarification resolved with incomplete payload ---

	it("stays in draft when clarification resolves but payload is missing contactId", async () => {
		// This reproduces the bug where a retried voice message was classified as
		// clarification_response, contact resolution was skipped, and the draft was
		// promoted to pending_confirmation without contactId — causing scheduler rejection.
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-clar-missing",
			version: 1,
			status: "draft",
			commandType: "create_note",
		};

		const clarificationWithoutContactId: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "I'll create a note about the artillery park.",
			commandType: "create_note",
			contactRef: null,
			commandPayload: { body: "Today we talked about going to the artillery park." },
			confidence: 0.85,
			needsClarification: false, // LLM thinks it's complete, but contactId is missing
		};

		const updatedRow = {
			id: "cmd-clar-missing",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			// Payload stored WITHOUT contactId — the bug scenario
			payload: { type: "create_note", body: "Today we talked about going to the artillery park." },
			status: "draft",
			version: 2,
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockUpdateDraftPayload.mockResolvedValue(updatedRow);

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(clarificationWithoutContactId, { activePendingCommand }));

		// Must NOT transition to pending_confirmation — payload is incomplete
		expect(mockTransitionStatus).not.toHaveBeenCalled();
		// Should stay in draft so the user can provide the missing info
		expect(update.actionOutcome).toEqual({ type: "edit_draft" });
	});

	// --- Step 4: Select callback handling ---

	it("select callback with version 0 is NOT stale-rejected when an active draft exists", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-sel-1",
			version: 1,
			status: "draft",
			commandType: "create_note",
		};

		const selectClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "I'll use Jane Doe.",
			commandType: "create_note",
			contactRef: "Jane Doe",
			commandPayload: { contactId: 42, body: "lunch" },
			confidence: 0.9,
			needsClarification: false,
		};

		// getPendingCommand returns the draft
		mockGetPendingCommand.mockResolvedValue({
			id: "cmd-sel-1",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "draft",
			version: 1,
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
		});

		const updatedRow = {
			id: "cmd-sel-1",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "lunch" },
			status: "draft",
			version: 2,
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockUpdateDraftPayload.mockResolvedValue(updatedRow);
		mockTransitionStatus.mockResolvedValue({
			...updatedRow,
			status: "pending_confirmation",
			version: 3,
		});

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(selectClassification, {
				activePendingCommand,
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "select",
					data: "42:0", // version 0 -- should NOT trigger stale rejection
				},
			}),
		);

		expect(update.actionOutcome).not.toEqual(expect.objectContaining({ type: "stale_rejected" }));
	});

	it("select callback updates draft contactId and transitions to pending_confirmation when needsClarification is false", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-sel-2",
			version: 1,
			status: "draft",
			commandType: "create_note",
		};

		const selectClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "I'll create a note for Jane.",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { body: "lunch" },
			confidence: 0.9,
			needsClarification: false,
		};

		mockGetPendingCommand.mockResolvedValue({
			id: "cmd-sel-2",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "draft",
			version: 1,
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
		});

		const updatedRow = {
			id: "cmd-sel-2",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "lunch" },
			status: "draft",
			version: 2,
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockUpdateDraftPayload.mockResolvedValue(updatedRow);

		const pendingConfRow = {
			...updatedRow,
			status: "pending_confirmation",
			version: 3,
		};
		mockTransitionStatus.mockResolvedValue(pendingConfRow);

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(selectClassification, {
				activePendingCommand,
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "select",
					data: "42:0",
				},
			}),
		);

		// updateDraftPayload should be called with contactId merged
		expect(mockUpdateDraftPayload).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-sel-2",
			1,
			expect.objectContaining({ contactId: 42 }),
			30,
		);
		// Must clear unresolvedContactRef from DB to prevent deferred re-resolution
		expect(mockClearUnresolvedContactRef).toHaveBeenCalledWith(expect.anything(), "cmd-sel-2");
		expect(mockTransitionStatus).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-sel-2",
			2,
			"draft",
			"pending_confirmation",
		);
		expect(update.actionOutcome).toEqual({
			type: "pending_created",
			pendingCommandId: "cmd-sel-2",
			version: 3,
		});
	});

	it("select callback updates draft but stays in draft if needsClarification is true", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-sel-3",
			version: 1,
			status: "draft",
			commandType: "create_note",
		};

		const selectClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Now which note body?",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { body: "lunch" },
			confidence: 0.5,
			needsClarification: true,
			clarificationReason: "missing_fields",
		};

		mockGetPendingCommand.mockResolvedValue({
			id: "cmd-sel-3",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "draft",
			version: 1,
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
		});

		const updatedRow = {
			id: "cmd-sel-3",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "lunch" },
			status: "draft",
			version: 2,
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockUpdateDraftPayload.mockResolvedValue(updatedRow);

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(selectClassification, {
				activePendingCommand,
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "select",
					data: "42:0",
				},
			}),
		);

		expect(mockUpdateDraftPayload).toHaveBeenCalled();
		expect(mockTransitionStatus).not.toHaveBeenCalled();
		expect(update.actionOutcome).toEqual({ type: "edit_draft" });
	});

	it("select callback rejects when no active draft exists", async () => {
		const selectClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "I'll use Jane Doe.",
			commandType: "create_note",
			contactRef: "Jane Doe",
			commandPayload: { contactId: 42, body: "lunch" },
			confidence: 0.9,
			needsClarification: false,
		};

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(selectClassification, {
				activePendingCommand: null,
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "select",
					data: "42:0",
				},
			}),
		);

		expect(update.actionOutcome).toEqual({
			type: "stale_rejected",
			reason: expect.stringContaining("No active command"),
		});
	});

	it("select callback guards against LLM fallback producing out_of_scope with confidence 0", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-sel-guard",
			version: 1,
			status: "draft",
			commandType: "create_note",
		};

		// LLM failure fallback: out_of_scope with confidence 0
		const fallbackClassification: IntentClassificationResult = {
			intent: "out_of_scope",
			detectedLanguage: "en",
			userFacingText:
				"I'm sorry, I'm having trouble processing your request right now. Please try again.",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0,
		};

		mockGetPendingCommand.mockResolvedValue({
			id: "cmd-sel-guard",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "lunch" },
			status: "draft",
			version: 1,
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
		});

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(fallbackClassification, {
				activePendingCommand,
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "select",
					data: "42:0",
				},
			}),
		);

		// Should NOT transition the draft. Should return passthrough (LLM error fallback).
		expect(mockUpdateDraftPayload).not.toHaveBeenCalled();
		expect(mockTransitionStatus).not.toHaveBeenCalled();
		expect(update.actionOutcome).toEqual({ type: "passthrough" });
	});

	// --- Contact resolution integration ---

	it("creates pending command with resolved contactId from contact resolution", async () => {
		// Simulates the state after resolveContactRef has run and set contactId
		const resolvedClassification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll add a note for Jane about lunch.",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { contactId: 42, body: "lunch" },
			confidence: 0.9,
			needsClarification: false,
		};

		const createdRow = {
			id: "cmd-cr",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
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

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(resolvedClassification));

		// Verify the contactId from resolution is in the pending command payload
		expect(mockCreatePendingCommand).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				payload: expect.objectContaining({
					contactId: 42,
				}),
			}),
		);
		expect(update.actionOutcome?.type).toBe("pending_created");
	});

	it("keeps command in draft when contact resolution sets needsClarification", async () => {
		// Simulates the state after resolveContactRef has set ambiguous outcome
		const ambiguousClassification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "Which Sherry did you mean?",
			commandType: "create_note",
			contactRef: "Sherry",
			commandPayload: { body: "coffee" },
			confidence: 0.85,
			needsClarification: true,
			clarificationReason: "ambiguous_contact",
			disambiguationOptions: [
				{ label: "Sherry Miller -- friend", value: "10" },
				{ label: "Sherry Johnson -- colleague", value: "20" },
			],
		};

		const createdRow = {
			id: "cmd-amb",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "coffee" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
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

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(ambiguousClassification));

		// needsClarification is true, so command stays in draft
		expect(update.actionOutcome?.type).toBe("edit_draft");
		expect(update.activePendingCommand?.status).toBe("draft");
		// Should not transition to pending_confirmation
		expect(mockTransitionStatus).not.toHaveBeenCalled();
	});

	// --- Narrowing context persistence ---

	it("persists narrowingContext after createPendingCommand when state.narrowingContext is non-null", async () => {
		const clarificationClassification: IntentClassificationResult = {
			...mutatingClassification,
			needsClarification: true,
			clarificationReason: "ambiguous_contact",
			confidence: 0.5,
		};

		const createdRow = {
			id: "cmd-nc-1",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "test" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
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

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: [],
			round: 0,
			narrowingCandidateIds: [1, 2, 3, 4, 5, 6],
		};

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(clarificationClassification, { narrowingContext }));

		expect(update.actionOutcome?.type).toBe("edit_draft");
		expect(mockUpdateNarrowingContext).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-nc-1",
			1,
			narrowingContext,
		);
	});

	it("persists narrowingContext after updateDraftPayload during clarification_response with active draft", async () => {
		const clarificationResponse: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Elena",
			commandType: "create_note",
			contactRef: "Elena",
			commandPayload: { contactId: 1, body: "test" },
			confidence: 0.8,
			needsClarification: true,
		};

		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-nc-2",
			version: 1,
			status: "draft",
			commandType: "create_note",
		};

		const updatedRow = {
			id: "cmd-nc-2",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 1, body: "test" },
			status: "draft",
			version: 2,
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockUpdateDraftPayload.mockResolvedValue(updatedRow);
		mockUpdateNarrowingContext.mockResolvedValue({ ...updatedRow, version: 3 });

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: ["Elena"],
			round: 1,
			narrowingCandidateIds: [1, 3],
		};

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(clarificationResponse, { activePendingCommand, narrowingContext }),
		);

		expect(mockUpdateNarrowingContext).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-nc-2",
			2,
			narrowingContext,
		);
	});

	it("clears narrowingContext before transitioning to pending_confirmation", async () => {
		const createdRow = {
			id: "cmd-nc-3",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "test" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
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
		mockClearNarrowingContext.mockResolvedValue({ ...createdRow, narrowingContext: null });
		mockTransitionStatus.mockResolvedValue({
			...createdRow,
			status: "pending_confirmation",
			version: 2,
		});

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: [],
			round: 0,
			narrowingCandidateIds: [42],
		};

		const node = createExecuteActionNode(makeDeps());
		// Not needsClarification, so it should transition to pending_confirmation
		const update = await node(makeState(mutatingClassification, { narrowingContext }));

		expect(mockClearNarrowingContext).toHaveBeenCalledWith(expect.anything(), "cmd-nc-3");
	});

	it("persists narrowingContext independently during clarification_response even when LLM produces no commandPayload (MEDIUM-1 fix)", async () => {
		// MEDIUM-1 from re-review: handleClarificationResponse returns passthrough
		// when commandType/commandPayload are null. Narrowing context must persist
		// independently BEFORE the existing handler logic.
		const clarificationResponse: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Elena",
			commandType: null,
			contactRef: null,
			commandPayload: null,
			confidence: 0.8,
		};

		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-nc-4",
			version: 1,
			status: "draft",
			commandType: "create_note",
		};

		mockUpdateNarrowingContext.mockResolvedValue({
			id: "cmd-nc-4",
			version: 2,
		});

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: ["Elena"],
			round: 1,
			narrowingCandidateIds: [1, 3],
		};

		const node = createExecuteActionNode(makeDeps());
		await node(makeState(clarificationResponse, { activePendingCommand, narrowingContext }));

		// Should persist narrowingContext even though handleClarificationResponse
		// would return passthrough (no commandType/commandPayload)
		expect(mockUpdateNarrowingContext).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-nc-4",
			1,
			narrowingContext,
		);
	});

	// --- Confirm-then-resolve: 6b - Skip payload validation when unresolvedContactRef is set ---

	it("skips payload validation when unresolvedContactRef is set (deferred resolution)", async () => {
		// Payload missing contactId, but unresolvedContactRef means it'll be resolved later
		const deferredClassification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll add a note to mom about the park.",
			commandType: "create_note",
			contactRef: "mom",
			commandPayload: { body: "went to the park" }, // no contactId - normally invalid
			confidence: 0.9,
			needsClarification: false,
		};

		const createdRow = {
			id: "cmd-defer-1",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "went to the park" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
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
		mockSetUnresolvedContactRef.mockResolvedValue({ ...createdRow, unresolvedContactRef: "mom" });
		mockTransitionStatus.mockResolvedValue({
			...createdRow,
			status: "pending_confirmation",
			version: 2,
		});

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(deferredClassification, { unresolvedContactRef: "mom" }));

		// Should create pending command despite missing contactId
		expect(mockCreatePendingCommand).toHaveBeenCalled();
		// Should store unresolvedContactRef in DB
		expect(mockSetUnresolvedContactRef).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-defer-1",
			"mom",
		);
		// Should transition to pending_confirmation
		expect(update.actionOutcome?.type).toBe("pending_created");
	});

	// --- Confirm-then-resolve: 6c - Store unresolvedContactRef after creating pending command ---

	it("stores unresolvedContactRef in DB after creating pending command", async () => {
		const deferredClassification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll add a note to mom.",
			commandType: "create_note",
			contactRef: "mom",
			commandPayload: { body: "park" },
			confidence: 0.9,
			needsClarification: false,
		};

		const createdRow = {
			id: "cmd-defer-2",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "park" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
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
		mockSetUnresolvedContactRef.mockResolvedValue({ ...createdRow, unresolvedContactRef: "mom" });
		mockTransitionStatus.mockResolvedValue({
			...createdRow,
			status: "pending_confirmation",
			version: 2,
		});

		const node = createExecuteActionNode(makeDeps());
		await node(makeState(deferredClassification, { unresolvedContactRef: "mom" }));

		expect(mockSetUnresolvedContactRef).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-defer-2",
			"mom",
		);
	});

	// --- Confirm-then-resolve: 6d - handleConfirm with deferred resolution ---

	it("handleConfirm merges contactId into payload when deferred resolution resolved", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-defer-3",
			version: 2,
			status: "pending_confirmation",
			commandType: "create_note",
		};

		const confirmClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Done! Note created.",
			commandType: "create_note",
			contactRef: null,
			commandPayload: { contactId: 42 },
			confidence: 1.0,
			needsClarification: false,
		};

		const pendingRow = {
			id: "cmd-defer-3",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "went to park" },
			status: "pending_confirmation",
			version: 2,
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			unresolvedContactRef: "mom",
		};
		mockGetPendingCommand.mockResolvedValue(pendingRow);

		const updatedRow = {
			...pendingRow,
			payload: { type: "create_note", contactId: 42, body: "went to park" },
			version: 3,
			unresolvedContactRef: null,
		};
		mockUpdatePendingPayload.mockResolvedValue(updatedRow);

		const confirmedRow = {
			...updatedRow,
			status: "confirmed",
			version: 4,
			confirmedAt: new Date(),
		};
		mockTransitionStatus.mockResolvedValue(confirmedRow);
		mockSchedulerExecute.mockResolvedValue({ executionId: "exec-1", status: "queued" });

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(confirmClassification, {
				activePendingCommand,
				contactResolution: {
					outcome: "resolved",
					resolved: {
						contactId: 42,
						displayName: "Mom Contact",
						aliases: ["Mom"],
						relationshipLabels: ["parent"],
						importantDates: [],
						lastInteractionAt: null,
					},
					candidates: [],
					query: "mom",
				},
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-defer-3:2",
				},
			}),
		);

		// Should merge contactId into payload
		expect(mockUpdatePendingPayload).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-defer-3",
			2,
			expect.objectContaining({ contactId: 42, body: "went to park" }),
		);
		// Should confirm and send to scheduler
		expect(update.actionOutcome?.type).toBe("confirmed");
		expect(mockSchedulerExecute).toHaveBeenCalled();
	});

	it("handleConfirm transitions to draft when deferred resolution is ambiguous", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-defer-4",
			version: 2,
			status: "pending_confirmation",
			commandType: "create_note",
		};

		const confirmClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Which contact did you mean?",
			commandType: "create_note",
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
			needsClarification: true,
			clarificationReason: "ambiguous_contact",
			disambiguationOptions: [
				{ label: "Elena Yuryevna", value: "10" },
				{ label: "Maria Petrova", value: "20" },
			],
		};

		const pendingRow = {
			id: "cmd-defer-4",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "went to park" },
			status: "pending_confirmation",
			version: 2,
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			unresolvedContactRef: "mom",
		};
		mockGetPendingCommand.mockResolvedValue(pendingRow);

		const draftRow = {
			...pendingRow,
			status: "draft",
			version: 3,
		};
		mockTransitionStatus.mockResolvedValue(draftRow);

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(confirmClassification, {
				activePendingCommand,
				contactResolution: {
					outcome: "ambiguous",
					resolved: null,
					candidates: [
						{ contactId: 10, displayName: "Elena Yuryevna", score: 0.5 },
						{ contactId: 20, displayName: "Maria Petrova", score: 0.5 },
					],
					query: "mom",
				},
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-defer-4:2",
				},
			}),
		);

		// Should transition back to draft for disambiguation
		expect(update.actionOutcome?.type).toBe("edit_draft");
		// Should NOT send to scheduler
		expect(mockSchedulerExecute).not.toHaveBeenCalled();
	});

	// --- Bug fix: Persist narrowingContext in handleConfirm's ambiguous path ---

	it("persists narrowingContext to DB when handleConfirm deferred resolution is ambiguous (>5 candidates)", async () => {
		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-narrow-persist",
			version: 2,
			status: "pending_confirmation",
			commandType: "create_note",
		};

		const confirmClassification: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: 'I found 8 contacts matching "mom". Can you tell me their name?',
			commandType: "create_note",
			contactRef: null,
			commandPayload: null,
			confidence: 1.0,
			needsClarification: true,
			clarificationReason: "ambiguous_contact",
		};

		const pendingRow = {
			id: "cmd-narrow-persist",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "she called me today" },
			status: "pending_confirmation",
			version: 2,
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			unresolvedContactRef: "mom",
		};
		mockGetPendingCommand.mockResolvedValue(pendingRow);

		const draftRow = {
			...pendingRow,
			status: "draft",
			version: 3,
		};
		mockTransitionStatus.mockResolvedValue(draftRow);
		mockUpdateNarrowingContext.mockResolvedValue({ ...draftRow, version: 4 });

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: [],
			round: 0,
			narrowingCandidateIds: [1, 2, 3, 4, 5, 6, 7, 8],
		};

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(confirmClassification, {
				activePendingCommand,
				narrowingContext,
				contactResolution: {
					outcome: "ambiguous",
					resolved: null,
					candidates: Array.from({ length: 5 }, (_, i) => ({
						contactId: i + 1,
						displayName: `Contact ${i + 1}`,
						score: 0.5,
					})),
					query: "mom",
				},
				inboundEvent: {
					type: "callback_action" as const,
					userId: "550e8400-e29b-41d4-a716-446655440000",
					sourceRef: "tg:cb:789",
					correlationId: "corr-123",
					action: "confirm",
					data: "cmd-narrow-persist:2",
				},
			}),
		);

		expect(update.actionOutcome?.type).toBe("edit_draft");
		// CRITICAL: narrowingContext must be persisted to DB so the next invocation can continue narrowing
		expect(mockUpdateNarrowingContext).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-narrow-persist",
			3,
			narrowingContext,
		);
	});

	// --- Bug fix: contactId merged into DB draft when narrowing resolves contact ---

	it("merges resolved contactId into existing DB draft payload during clarification_response (LLM commandType null)", async () => {
		// Scenario: narrowing resolved a single contact, but LLM only produced contactRef "Yelena"
		// with commandType null (common for name-only clarifications). The contactId must be merged
		// into the EXISTING DB draft payload, preserving the original note body.
		const clarificationResponse: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Thanks — what note would you like me to add for Yelena?",
			commandType: null,
			contactRef: "Yelena",
			commandPayload: null,
			confidence: 0.8,
			needsClarification: false,
		};

		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-merge-1",
			version: 2,
			status: "draft",
			commandType: "create_note",
		};

		// DB draft has the original payload with body but no contactId
		const dbDraftRow = {
			id: "cmd-merge-1",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "she called me today" },
			status: "draft",
			version: 2,
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockGetPendingCommand.mockResolvedValue(dbDraftRow);

		const updatedRow = {
			...dbDraftRow,
			payload: { type: "create_note", contactId: 42, body: "she called me today" },
			version: 3,
		};
		mockUpdateDraftPayload.mockResolvedValue(updatedRow);
		mockTransitionStatus.mockResolvedValue({
			...updatedRow,
			status: "pending_confirmation",
			version: 4,
		});

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(clarificationResponse, {
				activePendingCommand,
				contactResolution: {
					outcome: "resolved",
					resolved: {
						contactId: 42,
						displayName: "Yelena Yuryevna",
						aliases: ["Yelena"],
						relationshipLabels: ["parent"],
						importantDates: [],
						lastInteractionAt: null,
					},
					candidates: [],
					query: "mom",
				},
			}),
		);

		// Must merge contactId into the EXISTING DB payload, preserving body
		expect(mockUpdateDraftPayload).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-merge-1",
			2,
			expect.objectContaining({
				type: "create_note",
				contactId: 42,
				body: "she called me today",
			}),
			30,
		);
		// Must transition to pending_confirmation, not passthrough
		expect(update.actionOutcome?.type).toBe("pending_created");
		expect(mockTransitionStatus).toHaveBeenCalled();
	});

	it("merges resolved contactId into DB draft when LLM provides commandType but no body", async () => {
		// LLM reproduced commandType but not the body — system must use DB payload as base
		const clarificationResponse: IntentClassificationResult = {
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Got it, adding note to Yelena.",
			commandType: "create_note",
			contactRef: "Yelena",
			commandPayload: { contactId: 42 }, // LLM has contactId but lost the body
			confidence: 0.8,
			needsClarification: false,
		};

		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-merge-2",
			version: 2,
			status: "draft",
			commandType: "create_note",
		};

		const dbDraftRow = {
			id: "cmd-merge-2",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "she called me today" },
			status: "draft",
			version: 2,
			sourceMessageRef: "tg:msg:456",
			correlationId: "corr-123",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		mockGetPendingCommand.mockResolvedValue(dbDraftRow);

		const updatedRow = {
			...dbDraftRow,
			payload: { type: "create_note", contactId: 42, body: "she called me today" },
			version: 3,
		};
		mockUpdateDraftPayload.mockResolvedValue(updatedRow);
		mockTransitionStatus.mockResolvedValue({
			...updatedRow,
			status: "pending_confirmation",
			version: 4,
		});

		const node = createExecuteActionNode(makeDeps());
		const update = await node(
			makeState(clarificationResponse, {
				activePendingCommand,
				contactResolution: {
					outcome: "resolved",
					resolved: {
						contactId: 42,
						displayName: "Yelena Yuryevna",
						aliases: ["Yelena"],
						relationshipLabels: ["parent"],
						importantDates: [],
						lastInteractionAt: null,
					},
					candidates: [],
					query: "mom",
				},
			}),
		);

		// Must use DB payload as base, not LLM's commandPayload
		expect(mockUpdateDraftPayload).toHaveBeenCalledWith(
			expect.anything(),
			"cmd-merge-2",
			2,
			expect.objectContaining({
				type: "create_note",
				contactId: 42,
				body: "she called me today",
			}),
			30,
		);
		expect(update.actionOutcome?.type).toBe("pending_created");
	});

	it("does NOT skip auto-confirm when unresolvedContactRef is set", async () => {
		mockGetPreferences.mockResolvedValue({
			language: "en",
			confirmationMode: "auto",
			timezone: "UTC",
		});

		const deferredClassification: IntentClassificationResult = {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll add a note to mom.",
			commandType: "create_note",
			contactRef: "mom",
			commandPayload: { body: "park" },
			confidence: 0.97,
			needsClarification: false,
		};

		const createdRow = {
			id: "cmd-defer-auto",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { type: "create_note", body: "park" },
			status: "draft",
			version: 1,
			sourceMessageRef: "tg:msg:456",
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
		mockSetUnresolvedContactRef.mockResolvedValue({ ...createdRow, unresolvedContactRef: "mom" });
		mockTransitionStatus.mockResolvedValue({
			...createdRow,
			status: "pending_confirmation",
			version: 2,
		});

		const node = createExecuteActionNode(makeDeps());
		const update = await node(makeState(deferredClassification, { unresolvedContactRef: "mom" }));

		// Should NOT auto-confirm even if preferences allow it, because contact is unresolved
		expect(update.actionOutcome?.type).toBe("pending_created");
		expect(mockSchedulerExecute).not.toHaveBeenCalled();
	});
});
