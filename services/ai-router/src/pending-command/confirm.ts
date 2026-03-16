import type { ConfirmedCommandPayload, MutatingCommandPayload } from "@monica-companion/types";
import type { PendingCommandRow } from "./repository.js";

/**
 * Build a confirmed command payload from a pending command record.
 * This frozen snapshot is what ai-router sends to scheduler for execution.
 *
 * The idempotencyKey is deterministic: `${pendingCommandId}:v${version}`,
 * ensuring that the same confirmation can never be executed twice.
 */
export function buildConfirmedPayload(record: PendingCommandRow): ConfirmedCommandPayload {
	return {
		pendingCommandId: record.id,
		userId: record.userId,
		commandType: record.commandType as ConfirmedCommandPayload["commandType"],
		payload: record.payload as MutatingCommandPayload,
		idempotencyKey: `${record.id}:v${record.version}`,
		correlationId: record.correlationId,
		confirmedAt: record.confirmedAt ? record.confirmedAt.toISOString() : new Date().toISOString(),
	};
}
