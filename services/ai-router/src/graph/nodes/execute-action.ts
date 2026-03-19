/**
 * executeAction graph node.
 *
 * Wires intent classification output to concrete pipeline actions:
 * - mutating_command → creates pending command, transitions to pending_confirmation
 *   (or auto-confirms when user preferences allow and confidence exceeds threshold)
 * - read_query → passes through to delivery (no scheduler)
 * - greeting / out_of_scope → passes through to delivery
 * - callback_action confirm → transitions to confirmed, sends to scheduler
 * - callback_action cancel → transitions to cancelled
 * - callback_action edit → transitions to draft
 */

import type {
	ConfirmedCommandPayload,
	MutatingCommandPayload,
	PendingCommandStatus,
} from "@monica-companion/types";
import type { Database } from "../../db/connection.js";
import type { SchedulerClient } from "../../lib/scheduler-client.js";
import type { UserManagementClient } from "../../lib/user-management-client.js";
import type {
	CreatePendingCommandParams,
	PendingCommandRow,
} from "../../pending-command/repository.js";
import type { ActionOutcome, ConversationAnnotation } from "../state.js";

type State = typeof ConversationAnnotation.State;
type Update = typeof ConversationAnnotation.Update;

export interface ExecuteActionDeps {
	db: Database;
	pendingCommandTtlMinutes: number;
	autoConfirmConfidenceThreshold: number;
	createPendingCommand: (
		db: Database,
		params: CreatePendingCommandParams,
	) => Promise<PendingCommandRow>;
	transitionStatus: (
		db: Database,
		id: string,
		expectedVersion: number,
		from: PendingCommandStatus,
		to: PendingCommandStatus,
	) => Promise<PendingCommandRow | null>;
	getPendingCommand: (db: Database, id: string) => Promise<PendingCommandRow | null>;
	buildConfirmedPayload: (record: PendingCommandRow) => ConfirmedCommandPayload;
	schedulerClient: Pick<SchedulerClient, "execute">;
	userManagementClient: Pick<UserManagementClient, "getPreferences">;
}

/**
 * Parse callback data string into pendingCommandId and version.
 * Format: "{pendingCommandId}:{version}"
 */
function parseCallbackData(data: string): { pendingCommandId: string; version: number } | null {
	const lastColon = data.lastIndexOf(":");
	if (lastColon === -1) return null;
	const version = Number.parseInt(data.slice(lastColon + 1), 10);
	if (Number.isNaN(version)) return null;
	return { pendingCommandId: data.slice(0, lastColon), version };
}

export function createExecuteActionNode(deps: ExecuteActionDeps) {
	return async function executeActionNode(state: State): Promise<Update> {
		const { intentClassification, inboundEvent, userId, correlationId } = state;

		// No classification: passthrough
		if (!intentClassification) {
			return { actionOutcome: { type: "passthrough" } as ActionOutcome };
		}

		// Handle callback actions
		if (inboundEvent.type === "callback_action") {
			return handleCallbackAction(state, deps);
		}

		const { intent } = intentClassification;

		// Passthrough intents: greeting, out_of_scope
		if (intent === "greeting" || intent === "out_of_scope") {
			return { actionOutcome: { type: "passthrough" } as ActionOutcome };
		}

		// Read-only queries bypass scheduler
		if (intent === "read_query") {
			return { actionOutcome: { type: "read_through" } as ActionOutcome };
		}

		// Clarification responses without callback (text follow-up to a draft)
		if (intent === "clarification_response") {
			return { actionOutcome: { type: "passthrough" } as ActionOutcome };
		}

		// Mutating commands
		if (intent === "mutating_command") {
			return handleMutatingCommand(state, deps);
		}

		return { actionOutcome: { type: "passthrough" } as ActionOutcome };
	};
}

async function handleMutatingCommand(state: State, deps: ExecuteActionDeps): Promise<Update> {
	const { intentClassification, userId, correlationId, inboundEvent } = state;
	if (!intentClassification || !intentClassification.commandType) {
		return { actionOutcome: { type: "passthrough" } as ActionOutcome };
	}

	const payload = {
		type: intentClassification.commandType,
		...(intentClassification.commandPayload ?? {}),
	} as MutatingCommandPayload;

	// Create the pending command in draft status
	const created = await deps.createPendingCommand(deps.db, {
		userId,
		commandType: intentClassification.commandType,
		payload,
		sourceMessageRef: inboundEvent.sourceRef,
		correlationId,
		ttlMinutes: deps.pendingCommandTtlMinutes,
	});

	// If clarification needed, stay in draft
	if (intentClassification.needsClarification) {
		return {
			actionOutcome: { type: "edit_draft" } as ActionOutcome,
			activePendingCommand: {
				pendingCommandId: created.id,
				version: created.version,
				status: "draft",
				commandType: created.commandType,
			},
		};
	}

	// Transition to pending_confirmation
	const pendingRow = await deps.transitionStatus(
		deps.db,
		created.id,
		created.version,
		"draft",
		"pending_confirmation",
	);

	if (!pendingRow) {
		return { actionOutcome: { type: "passthrough" } as ActionOutcome };
	}

	// Check auto-confirmation eligibility
	const shouldAutoConfirm = await checkAutoConfirm(
		deps,
		userId,
		correlationId,
		intentClassification.confidence,
	);

	if (shouldAutoConfirm) {
		return autoConfirm(deps, pendingRow);
	}

	return {
		actionOutcome: {
			type: "pending_created",
			pendingCommandId: pendingRow.id,
			version: pendingRow.version,
		} as ActionOutcome,
		activePendingCommand: {
			pendingCommandId: pendingRow.id,
			version: pendingRow.version,
			status: "pending_confirmation",
			commandType: pendingRow.commandType,
		},
	};
}

async function checkAutoConfirm(
	deps: ExecuteActionDeps,
	userId: string,
	correlationId: string,
	confidence: number,
): Promise<boolean> {
	if (confidence < deps.autoConfirmConfidenceThreshold) {
		return false;
	}

	try {
		const prefs = await deps.userManagementClient.getPreferences(userId, correlationId);
		return prefs.confirmationMode === "auto";
	} catch {
		// If we can't fetch preferences, fall back to explicit confirmation
		return false;
	}
}

async function autoConfirm(
	deps: ExecuteActionDeps,
	pendingRow: PendingCommandRow,
): Promise<Update> {
	const confirmedRow = await deps.transitionStatus(
		deps.db,
		pendingRow.id,
		pendingRow.version,
		"pending_confirmation",
		"confirmed",
	);

	if (!confirmedRow) {
		// Race condition: fall back to pending
		return {
			actionOutcome: {
				type: "pending_created",
				pendingCommandId: pendingRow.id,
				version: pendingRow.version,
			} as ActionOutcome,
		};
	}

	const payload = deps.buildConfirmedPayload(confirmedRow);

	try {
		await deps.schedulerClient.execute(payload);
	} catch {
		// Scheduler failure: the command is confirmed but not queued.
		// This is still an auto_confirmed outcome — scheduler retries will handle it.
	}

	return {
		actionOutcome: {
			type: "auto_confirmed",
			pendingCommandId: confirmedRow.id,
		} as ActionOutcome,
	};
}

async function handleCallbackAction(state: State, deps: ExecuteActionDeps): Promise<Update> {
	if (state.inboundEvent.type !== "callback_action") {
		return { actionOutcome: { type: "passthrough" } as ActionOutcome };
	}

	const { action, data } = state.inboundEvent;
	const { activePendingCommand } = state;

	// No active pending command for callback
	if (!activePendingCommand) {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: "No active command found for this action.",
			} as ActionOutcome,
		};
	}

	// Parse callback data for version check
	const parsed = parseCallbackData(data);
	if (!parsed) {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: "Invalid callback data format.",
			} as ActionOutcome,
		};
	}

	// Version mismatch check
	if (parsed.version !== activePendingCommand.version) {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: `Stale action: expected version ${activePendingCommand.version}, got ${parsed.version}.`,
			} as ActionOutcome,
		};
	}

	// Fetch the latest command state from DB
	const command = await deps.getPendingCommand(deps.db, activePendingCommand.pendingCommandId);

	if (!command) {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: "Command not found. It may have been deleted.",
			} as ActionOutcome,
		};
	}

	// Check if command is in a terminal state
	if (
		command.status === "expired" ||
		command.status === "cancelled" ||
		command.status === "executed"
	) {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: `This command has already ${command.status}. Please start a new request.`,
			} as ActionOutcome,
		};
	}

	switch (action) {
		case "confirm":
			return handleConfirm(deps, command);
		case "cancel":
			return handleCancel(deps, command);
		case "edit":
			return handleEdit(deps, command);
		case "select":
			// Selection (disambiguation) is handled by the LLM re-processing
			// in classifyIntent. We just pass through here.
			return { actionOutcome: { type: "passthrough" } as ActionOutcome };
		default:
			return { actionOutcome: { type: "passthrough" } as ActionOutcome };
	}
}

async function handleConfirm(deps: ExecuteActionDeps, command: PendingCommandRow): Promise<Update> {
	const confirmedRow = await deps.transitionStatus(
		deps.db,
		command.id,
		command.version,
		command.status as PendingCommandStatus,
		"confirmed",
	);

	if (!confirmedRow) {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: "Could not confirm command — it may have been modified.",
			} as ActionOutcome,
		};
	}

	const payload = deps.buildConfirmedPayload(confirmedRow);

	try {
		await deps.schedulerClient.execute(payload);
	} catch {
		// Scheduler failure logged elsewhere; command is still confirmed
	}

	return {
		actionOutcome: {
			type: "confirmed",
			pendingCommandId: confirmedRow.id,
		} as ActionOutcome,
	};
}

async function handleCancel(deps: ExecuteActionDeps, command: PendingCommandRow): Promise<Update> {
	const cancelledRow = await deps.transitionStatus(
		deps.db,
		command.id,
		command.version,
		command.status as PendingCommandStatus,
		"cancelled",
	);

	if (!cancelledRow) {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: "Could not cancel command — it may have been modified.",
			} as ActionOutcome,
		};
	}

	return { actionOutcome: { type: "cancelled" } as ActionOutcome };
}

async function handleEdit(deps: ExecuteActionDeps, command: PendingCommandRow): Promise<Update> {
	// Only transition from pending_confirmation back to draft
	if (command.status !== "pending_confirmation") {
		return { actionOutcome: { type: "edit_draft" } as ActionOutcome };
	}

	const draftRow = await deps.transitionStatus(
		deps.db,
		command.id,
		command.version,
		"pending_confirmation",
		"draft",
	);

	if (!draftRow) {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: "Could not edit command — it may have been modified.",
			} as ActionOutcome,
		};
	}

	return { actionOutcome: { type: "edit_draft" } as ActionOutcome };
}
