/**
 * PendingToolCall schema and utilities.
 *
 * Defines the Zod schema for pending tool calls stored in the
 * conversationHistory JSONB column, plus TTL expiry checking.
 */

import { z } from "zod/v4";

/**
 * Schema for a pending tool call stored in conversation history.
 * Validated when loaded from JSONB to ensure data integrity.
 */
export const PendingToolCallSchema = z.object({
	/** Unique identifier for this pending command, used for callback identity verification. */
	pendingCommandId: z.string().min(1),
	/** Tool function name (e.g., "create_note"). */
	name: z.string().min(1),
	/** JSON-serialized tool arguments. */
	arguments: z.string(),
	/** The LLM-assigned tool call ID (e.g., "call_abc123"). */
	toolCallId: z.string().min(1),
	/** Human-readable description of the action for the confirmation prompt. */
	actionDescription: z.string().min(1),
	/** ISO 8601 timestamp of when the pending tool call was created. */
	createdAt: z.string().min(1),
	/** The full assistant message that contained this tool call, stored for history reconstruction. */
	assistantMessage: z.record(z.string(), z.unknown()),
	/** Read-only tool results collected in the same LLM turn as the intercepted mutating call. */
	collectedToolResults: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type PendingToolCall = z.infer<typeof PendingToolCallSchema>;

/**
 * Check whether a pending tool call has exceeded its TTL.
 * Returns true if the pending tool call is expired (createdAt + ttlMinutes <= now).
 */
export function isPendingToolCallExpired(
	pendingToolCall: Pick<PendingToolCall, "createdAt">,
	ttlMinutes: number,
): boolean {
	const createdAtMs = new Date(pendingToolCall.createdAt).getTime();
	const expiresAtMs = createdAtMs + ttlMinutes * 60 * 1000;
	return Date.now() >= expiresAtMs;
}
