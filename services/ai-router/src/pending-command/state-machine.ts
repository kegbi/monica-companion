import type { PendingCommandStatus } from "@monica-companion/types";

/**
 * Valid state transitions for pending commands.
 *
 * draft -> pending_confirmation (AI has built the command, needs user OK)
 * draft -> cancelled (user cancels before confirmation)
 * draft -> expired (TTL elapsed)
 * pending_confirmation -> confirmed (user approves)
 * pending_confirmation -> cancelled (user rejects)
 * pending_confirmation -> expired (TTL elapsed)
 * pending_confirmation -> draft (edit/disambiguation requested)
 * confirmed -> executed (scheduler has completed execution)
 */
const VALID_TRANSITIONS: Record<PendingCommandStatus, ReadonlySet<PendingCommandStatus>> = {
	draft: new Set(["pending_confirmation", "cancelled", "expired"]),
	pending_confirmation: new Set(["confirmed", "cancelled", "expired", "draft"]),
	confirmed: new Set(["executed"]),
	executed: new Set(),
	expired: new Set(),
	cancelled: new Set(),
};

const TERMINAL_STATUSES: ReadonlySet<PendingCommandStatus> = new Set([
	"executed",
	"expired",
	"cancelled",
]);

/**
 * Assert that a transition from `from` to `to` is valid.
 * Throws if the transition is not allowed.
 */
export function assertTransition(from: PendingCommandStatus, to: PendingCommandStatus): void {
	const allowed = VALID_TRANSITIONS[from];
	if (!allowed.has(to)) {
		throw new Error(`Invalid transition from '${from}' to '${to}'`);
	}
}

/**
 * Returns true if the status is terminal (no further transitions possible).
 */
export function isTerminal(status: PendingCommandStatus): boolean {
	return TERMINAL_STATUSES.has(status);
}

/**
 * Returns true if the status is active (non-terminal).
 */
export function isActive(status: PendingCommandStatus): boolean {
	return !isTerminal(status);
}
