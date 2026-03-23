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

import { createLogger } from "@monica-companion/observability";
import {
	type ConfirmedCommandPayload,
	type MutatingCommandPayload,
	MutatingCommandPayloadSchema,
	type PendingCommandStatus,
} from "@monica-companion/types";
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("ai-router");
const logger = createLogger("ai-router:execute-action");

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
	updateDraftPayload: (
		db: Database,
		id: string,
		expectedVersion: number,
		newPayload: MutatingCommandPayload,
		ttlMinutes: number,
	) => Promise<PendingCommandRow | null>;
	updateNarrowingContext: (
		db: Database,
		id: string,
		expectedVersion: number,
		narrowingContext: Record<string, unknown>,
	) => Promise<PendingCommandRow | null>;
	clearNarrowingContext: (db: Database, id: string) => Promise<PendingCommandRow | null>;
	updatePendingPayload: (
		db: Database,
		id: string,
		expectedVersion: number,
		newPayload: MutatingCommandPayload,
	) => Promise<PendingCommandRow | null>;
	setUnresolvedContactRef: (
		db: Database,
		id: string,
		contactRef: string,
	) => Promise<PendingCommandRow | null>;
	clearUnresolvedContactRef: (db: Database, id: string) => Promise<PendingCommandRow | null>;
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
		return tracer.startActiveSpan("ai-router.graph.execute_action", async (span) => {
			try {
				const { intentClassification, inboundEvent } = state;

				// No classification: passthrough
				if (!intentClassification) {
					const outcome = { type: "passthrough" } as ActionOutcome;
					span.setAttribute("ai-router.action_outcome", outcome.type);
					return { actionOutcome: outcome };
				}

				// Handle callback actions
				if (inboundEvent.type === "callback_action") {
					const result = await handleCallbackAction(state, deps);
					if (result.actionOutcome) {
						span.setAttribute("ai-router.action_outcome", result.actionOutcome.type);
					}
					return result;
				}

				const { intent } = intentClassification;

				// Passthrough intents: greeting, out_of_scope
				if (intent === "greeting" || intent === "out_of_scope") {
					span.setAttribute("ai-router.action_outcome", "passthrough");
					return { actionOutcome: { type: "passthrough" } as ActionOutcome };
				}

				// Read-only queries bypass scheduler
				if (intent === "read_query") {
					span.setAttribute("ai-router.action_outcome", "read_through");
					return { actionOutcome: { type: "read_through" } as ActionOutcome };
				}

				// Clarification responses without callback (text follow-up to a draft)
				if (intent === "clarification_response") {
					const result = await handleClarificationResponse(state, deps);
					if (result.actionOutcome) {
						span.setAttribute("ai-router.action_outcome", result.actionOutcome.type);
					}
					return result;
				}

				// Mutating commands
				if (intent === "mutating_command") {
					const result = await handleMutatingCommand(state, deps);
					if (result.actionOutcome) {
						span.setAttribute("ai-router.action_outcome", result.actionOutcome.type);
					}
					return result;
				}

				span.setAttribute("ai-router.action_outcome", "passthrough");
				return { actionOutcome: { type: "passthrough" } as ActionOutcome };
			} finally {
				span.end();
			}
		});
	};
}

/**
 * Shared helper: transition a draft to pending_confirmation and check auto-confirm.
 * Used by handleMutatingCommand, handleClarificationResponse, and handleSelect
 * to avoid DRY violation (review MEDIUM-1).
 */
async function transitionToConfirmationAndCheckAutoConfirm(
	state: State,
	deps: ExecuteActionDeps,
	draftRow: PendingCommandRow,
): Promise<Update> {
	const pendingRow = await deps.transitionStatus(
		deps.db,
		draftRow.id,
		draftRow.version,
		"draft",
		"pending_confirmation",
	);

	if (!pendingRow) {
		return { actionOutcome: { type: "passthrough" } as ActionOutcome };
	}

	const shouldAutoConfirm = await checkAutoConfirm(
		deps,
		state.userId,
		state.correlationId,
		state.intentClassification?.confidence ?? 0,
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

async function handleMutatingCommand(state: State, deps: ExecuteActionDeps): Promise<Update> {
	const { intentClassification, userId, correlationId, inboundEvent } = state;
	if (!intentClassification || !intentClassification.commandType) {
		return { actionOutcome: { type: "passthrough" } as ActionOutcome };
	}

	const payload = {
		type: intentClassification.commandType,
		...(intentClassification.commandPayload ?? {}),
	} as MutatingCommandPayload;

	// Step 1: Validate complete payloads against MutatingCommandPayloadSchema.
	// When needsClarification is false, the LLM claims the payload is complete --
	// strict validation catches malformed payloads before they enter the lifecycle.
	// When needsClarification is true, skip validation: the payload is intentionally
	// incomplete and will be validated after clarification resolves.
	// When unresolvedContactRef is set, skip validation: the contactId will be
	// injected after deferred contact resolution on the confirm callback.
	const hasUnresolvedContactRef = !!state.unresolvedContactRef;
	if (!intentClassification.needsClarification && !hasUnresolvedContactRef) {
		const validated = MutatingCommandPayloadSchema.safeParse(payload);
		if (!validated.success) {
			logger.warn("Payload validation failed for complete mutating command", {
				commandType: intentClassification.commandType,
				correlationId,
			});
			return { actionOutcome: { type: "passthrough" } as ActionOutcome };
		}
	}

	// Create the pending command in draft status
	const created = await deps.createPendingCommand(deps.db, {
		userId,
		commandType: intentClassification.commandType,
		payload,
		sourceMessageRef: inboundEvent.sourceRef,
		correlationId,
		ttlMinutes: deps.pendingCommandTtlMinutes,
	});

	// Store unresolvedContactRef in DB for deferred resolution
	if (hasUnresolvedContactRef) {
		await deps.setUnresolvedContactRef(deps.db, created.id, state.unresolvedContactRef!);
	}

	// Persist narrowing context if present
	if (state.narrowingContext) {
		await deps.updateNarrowingContext(
			deps.db,
			created.id,
			created.version,
			state.narrowingContext as unknown as Record<string, unknown>,
		);
	}

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

	// Clear narrowing context before transition to pending_confirmation
	if (state.narrowingContext) {
		await deps.clearNarrowingContext(deps.db, created.id);
	}

	// Skip auto-confirm when unresolvedContactRef is set -- the user must
	// explicitly confirm so the confirm callback triggers deferred resolution.
	if (hasUnresolvedContactRef) {
		return transitionToConfirmationSkipAutoConfirm(deps, created);
	}

	return transitionToConfirmationAndCheckAutoConfirm(state, deps, created);
}

async function handleClarificationResponse(state: State, deps: ExecuteActionDeps): Promise<Update> {
	const { intentClassification, activePendingCommand } = state;

	// --- Contact resolution merge path ---
	// When contactResolution resolved a contact (via narrowing or direct resolution)
	// and there is an active draft, merge the contactId into the EXISTING DB payload.
	// This handles cases where the LLM didn't reproduce the full commandPayload for
	// name-only clarifications (e.g., user said "Yelena" during narrowing).
	if (
		state.contactResolution?.outcome === "resolved" &&
		state.contactResolution.resolved &&
		activePendingCommand &&
		activePendingCommand.status === "draft"
	) {
		const command = await deps.getPendingCommand(deps.db, activePendingCommand.pendingCommandId);
		if (command) {
			const existingPayload = command.payload as Record<string, unknown>;
			const mergedPayload = {
				...existingPayload,
				contactId: state.contactResolution.resolved.contactId,
			} as MutatingCommandPayload;

			const validated = MutatingCommandPayloadSchema.safeParse(mergedPayload);
			if (validated.success) {
				const updatedRow = await deps.updateDraftPayload(
					deps.db,
					command.id,
					command.version,
					mergedPayload,
					deps.pendingCommandTtlMinutes,
				);
				if (updatedRow) {
					if (state.narrowingContext) {
						await deps.clearNarrowingContext(deps.db, updatedRow.id);
					}
					return transitionToConfirmationAndCheckAutoConfirm(state, deps, updatedRow);
				}
			}
		}
	}

	// MEDIUM-1 fix: Persist narrowing context independently BEFORE the existing handler logic.
	// During narrowing, short replies like "Elena" may not produce commandType/commandPayload
	// from the LLM, which would cause the passthrough guard below to fire.
	// We must persist the narrowing context regardless, but ONLY on the passthrough path
	// to avoid version conflicts with updateDraftPayload.
	const wouldPassthrough =
		!activePendingCommand ||
		activePendingCommand.status !== "draft" ||
		!intentClassification ||
		!intentClassification.commandType ||
		!intentClassification.commandPayload;

	if (
		wouldPassthrough &&
		state.narrowingContext &&
		activePendingCommand &&
		activePendingCommand.status === "draft"
	) {
		await deps.updateNarrowingContext(
			deps.db,
			activePendingCommand.pendingCommandId,
			activePendingCommand.version,
			state.narrowingContext as unknown as Record<string, unknown>,
		);
	}

	// Fall through to passthrough if no active draft or no commandPayload from LLM
	if (wouldPassthrough) {
		return { actionOutcome: { type: "passthrough" } as ActionOutcome };
	}

	const newPayload = {
		type: intentClassification.commandType,
		...(intentClassification.commandPayload ?? {}),
	} as MutatingCommandPayload;

	const updatedRow = await deps.updateDraftPayload(
		deps.db,
		activePendingCommand.pendingCommandId,
		activePendingCommand.version,
		newPayload,
		deps.pendingCommandTtlMinutes,
	);

	// Race condition: draft was modified concurrently
	if (!updatedRow) {
		return { actionOutcome: { type: "passthrough" } as ActionOutcome };
	}

	// Persist narrowing context after draft payload update (non-passthrough path)
	if (state.narrowingContext) {
		await deps.updateNarrowingContext(
			deps.db,
			updatedRow.id,
			updatedRow.version,
			state.narrowingContext as unknown as Record<string, unknown>,
		);
	}

	// If clarification is still incomplete, stay in draft
	if (intentClassification.needsClarification) {
		return {
			actionOutcome: { type: "edit_draft" } as ActionOutcome,
			activePendingCommand: {
				pendingCommandId: updatedRow.id,
				version: updatedRow.version,
				status: "draft",
				commandType: updatedRow.commandType,
			},
		};
	}

	// Clarification resolved: validate the final payload before transitioning.
	// This prevents incomplete payloads (e.g. missing contactId after a retried
	// voice message) from reaching the scheduler.
	const resolvedPayload = updatedRow.payload as Record<string, unknown>;
	const validated = MutatingCommandPayloadSchema.safeParse(resolvedPayload);
	if (!validated.success) {
		logger.warn("Payload validation failed after clarification resolved — staying in draft", {
			commandType: intentClassification.commandType,
			correlationId: state.correlationId,
		});
		return {
			actionOutcome: { type: "edit_draft" } as ActionOutcome,
			activePendingCommand: {
				pendingCommandId: updatedRow.id,
				version: updatedRow.version,
				status: "draft",
				commandType: updatedRow.commandType,
			},
		};
	}

	// Clear narrowing context before transitioning to pending_confirmation
	if (state.narrowingContext) {
		await deps.clearNarrowingContext(deps.db, updatedRow.id);
	}

	// Clarification resolved: transition to pending_confirmation
	return transitionToConfirmationAndCheckAutoConfirm(state, deps, updatedRow);
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
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.warn(
			"Failed to fetch user preferences for auto-confirm check, falling back to explicit",
			{
				userId,
				correlationId,
				error: msg,
			},
		);
		return false;
	}
}

/**
 * Transition a draft to pending_confirmation WITHOUT checking auto-confirm.
 * Used when unresolvedContactRef is set -- the user must explicitly confirm
 * so the confirm callback triggers deferred contact resolution.
 */
async function transitionToConfirmationSkipAutoConfirm(
	deps: ExecuteActionDeps,
	draftRow: PendingCommandRow,
): Promise<Update> {
	const pendingRow = await deps.transitionStatus(
		deps.db,
		draftRow.id,
		draftRow.version,
		"draft",
		"pending_confirmation",
	);

	if (!pendingRow) {
		return { actionOutcome: { type: "passthrough" } as ActionOutcome };
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
		logger.info("Auto-confirmed command sent to scheduler", {
			pendingCommandId: confirmedRow.id,
			commandType: confirmedRow.commandType,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error("Scheduler rejected auto-confirmed command — command will NOT execute", {
			pendingCommandId: confirmedRow.id,
			commandType: confirmedRow.commandType,
			correlationId: confirmedRow.correlationId,
			error: msg,
		});
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

	// Step 4: Handle select callbacks before version check.
	// Disambiguation buttons encode data as "select:{contactValue}:0" (version always 0).
	// After telegram-bridge strips the prefix, ai-router gets "{contactValue}:0".
	// parseCallbackData returns { pendingCommandId: contactValue, version: 0 }.
	// The version check would always reject these as stale, so we branch early.
	if (action === "select") {
		return handleSelect(state, deps, parsed);
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

	// Step 2: Check TTL expiry even if the sweep hasn't run yet
	if (command.expiresAt instanceof Date && command.expiresAt < new Date()) {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: "This command has expired. Please start a new request.",
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
			return handleConfirm(state, deps, command);
		case "cancel":
			return handleCancel(deps, command);
		case "edit":
			return handleEdit(deps, command);
		default:
			return { actionOutcome: { type: "passthrough" } as ActionOutcome };
	}
}

async function handleConfirm(
	state: State,
	deps: ExecuteActionDeps,
	command: PendingCommandRow,
): Promise<Update> {
	// --- Confirm-then-resolve: Handle deferred contact resolution ---
	// When contactResolution is set from the resolveContactRef node's deferred
	// resolution, we need to handle it before confirming.
	const { contactResolution, intentClassification } = state;

	if (contactResolution) {
		// Deferred resolution produced a result
		if (contactResolution.outcome === "resolved" && contactResolution.resolved) {
			// Resolved: merge contactId into the pending command payload
			const existingPayload = command.payload as Record<string, unknown>;
			const mergedPayload = {
				...existingPayload,
				contactId: contactResolution.resolved.contactId,
			} as MutatingCommandPayload;

			// MEDIUM-2: Validate merged payload before confirming
			const validated = MutatingCommandPayloadSchema.safeParse(mergedPayload);
			if (!validated.success) {
				logger.warn("Payload validation failed after deferred contact resolution", {
					commandType: command.commandType,
					correlationId: command.correlationId,
				});
				// Transition back to draft for manual fix
				const draftRow = await deps.transitionStatus(
					deps.db,
					command.id,
					command.version,
					command.status as PendingCommandStatus,
					"draft",
				);
				return {
					actionOutcome: { type: "edit_draft" } as ActionOutcome,
					activePendingCommand: draftRow
						? {
								pendingCommandId: draftRow.id,
								version: draftRow.version,
								status: "draft",
								commandType: draftRow.commandType,
							}
						: null,
				};
			}

			// Update the payload with contactId and clear unresolvedContactRef
			const updatedRow = await deps.updatePendingPayload(
				deps.db,
				command.id,
				command.version,
				mergedPayload,
			);

			if (!updatedRow) {
				return {
					actionOutcome: {
						type: "stale_rejected",
						reason: "Could not update command payload — it may have been modified.",
					} as ActionOutcome,
				};
			}

			// Now confirm with the updated command
			command = updatedRow;
		} else if (
			contactResolution.outcome === "ambiguous" ||
			contactResolution.outcome === "no_match"
		) {
			// Clear unresolvedContactRef from DB so the next confirm callback
			// after disambiguation does not re-trigger deferred resolution.
			await deps.clearUnresolvedContactRef(deps.db, command.id);

			// Ambiguous or no match: transition back to draft for disambiguation
			const draftRow = await deps.transitionStatus(
				deps.db,
				command.id,
				command.version,
				command.status as PendingCommandStatus,
				"draft",
			);

			if (!draftRow) {
				return {
					actionOutcome: {
						type: "stale_rejected",
						reason: "Could not transition command for disambiguation.",
					} as ActionOutcome,
				};
			}

			// Persist narrowingContext to DB so the next invocation can continue
			// the progressive narrowing flow. Without this, the narrowingContext
			// set by resolveDeferredContact in graph state would be lost between
			// invocations, breaking multi-turn narrowing after confirm-then-resolve.
			if (state.narrowingContext) {
				await deps.updateNarrowingContext(
					deps.db,
					draftRow.id,
					draftRow.version,
					state.narrowingContext as unknown as Record<string, unknown>,
				);
			}

			return {
				actionOutcome: { type: "edit_draft" } as ActionOutcome,
				activePendingCommand: {
					pendingCommandId: draftRow.id,
					version: draftRow.version,
					status: "draft",
					commandType: draftRow.commandType,
				},
			};
		}
	}

	// Standard confirm path
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
		logger.info("Confirmed command sent to scheduler", {
			pendingCommandId: confirmedRow.id,
			commandType: confirmedRow.commandType,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error("Scheduler rejected confirmed command — command will NOT execute", {
			pendingCommandId: confirmedRow.id,
			commandType: confirmedRow.commandType,
			correlationId: confirmedRow.correlationId,
			error: msg,
		});
		return {
			actionOutcome: {
				type: "confirmed",
				pendingCommandId: confirmedRow.id,
				schedulerError: msg,
			} as ActionOutcome,
		};
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

/**
 * Handle a select (disambiguation) callback.
 * parsed.pendingCommandId contains the selected contact value (not a real command ID).
 * The actual pending command is looked up via state.activePendingCommand.
 */
async function handleSelect(
	state: State,
	deps: ExecuteActionDeps,
	parsed: { pendingCommandId: string; version: number },
): Promise<Update> {
	const { activePendingCommand, intentClassification } = state;

	// LOW-2 from review: guard against LLM fallback producing out_of_scope with confidence 0.
	// If the LLM failed during the select callback, the fallback has intent: "out_of_scope"
	// and confidence: 0, which would incorrectly trigger a state transition.
	if (
		!intentClassification ||
		intentClassification.intent === "out_of_scope" ||
		intentClassification.intent === "greeting"
	) {
		return { actionOutcome: { type: "passthrough" } as ActionOutcome };
	}

	if (!activePendingCommand) {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: "No active command found for this action.",
			} as ActionOutcome,
		};
	}

	// Fetch the real draft from DB using activePendingCommand (not parsed.pendingCommandId)
	const command = await deps.getPendingCommand(deps.db, activePendingCommand.pendingCommandId);

	if (!command || command.status !== "draft") {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: "Command not found or not in draft status.",
			} as ActionOutcome,
		};
	}

	// Check TTL expiry
	if (command.expiresAt instanceof Date && command.expiresAt < new Date()) {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: "This command has expired. Please start a new request.",
			} as ActionOutcome,
		};
	}

	// Parse the selected value as a contactId (Monica contact IDs are numeric)
	const selectedValue = parsed.pendingCommandId;
	const contactId = Number(selectedValue);
	if (Number.isNaN(contactId)) {
		return {
			actionOutcome: {
				type: "stale_rejected",
				reason: "Invalid selection value.",
			} as ActionOutcome,
		};
	}

	// Merge the selected contactId into the existing draft payload
	const existingPayload = command.payload as Record<string, unknown>;
	const mergedPayload = {
		...existingPayload,
		contactId,
	} as MutatingCommandPayload;

	const updatedRow = await deps.updateDraftPayload(
		deps.db,
		command.id,
		command.version,
		mergedPayload,
		deps.pendingCommandTtlMinutes,
	);

	if (!updatedRow) {
		return { actionOutcome: { type: "passthrough" } as ActionOutcome };
	}

	// Contact selected — clear the deferred contactRef from DB so the next
	// confirm callback does not re-trigger deferred resolution.
	await deps.clearUnresolvedContactRef(deps.db, command.id);

	// If clarification is still incomplete, stay in draft
	if (intentClassification.needsClarification) {
		return {
			actionOutcome: { type: "edit_draft" } as ActionOutcome,
			activePendingCommand: {
				pendingCommandId: updatedRow.id,
				version: updatedRow.version,
				status: "draft",
				commandType: updatedRow.commandType,
			},
		};
	}

	// Validate the merged payload before transitioning to pending_confirmation.
	const selectPayload = updatedRow.payload as Record<string, unknown>;
	const selectValidated = MutatingCommandPayloadSchema.safeParse(selectPayload);
	if (!selectValidated.success) {
		logger.warn("Payload validation failed after select — staying in draft", {
			commandType: updatedRow.commandType,
			correlationId: state.correlationId,
		});
		return {
			actionOutcome: { type: "edit_draft" } as ActionOutcome,
			activePendingCommand: {
				pendingCommandId: updatedRow.id,
				version: updatedRow.version,
				status: "draft",
				commandType: updatedRow.commandType,
			},
		};
	}

	// Clarification resolved: transition to pending_confirmation
	return transitionToConfirmationAndCheckAutoConfirm(state, deps, updatedRow);
}
