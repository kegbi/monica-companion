import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntentClassificationResult } from "../../intent-schemas.js";
import type { ActionOutcome, PendingCommandRef } from "../../state.js";
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
		resolvedContact: null,
		userPreferences: null,
		intentClassification,
		actionOutcome: null,
		response: null,
		...overrides,
	};
}

const mockCreatePendingCommand = vi.fn();
const mockTransitionStatus = vi.fn();
const mockGetPendingCommand = vi.fn();
const mockSchedulerExecute = vi.fn();
const mockGetPreferences = vi.fn();

function makeDeps(overrides: Partial<ExecuteActionDeps> = {}): ExecuteActionDeps {
	return {
		db: {} as any,
		pendingCommandTtlMinutes: 30,
		autoConfirmConfidenceThreshold: 0.95,
		createPendingCommand: mockCreatePendingCommand,
		transitionStatus: mockTransitionStatus,
		getPendingCommand: mockGetPendingCommand,
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
	commandPayload: { body: "lunch" },
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
			expiresAt: new Date(),
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
			expiresAt: new Date(),
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
			expiresAt: new Date(),
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
});
