import type Redis from "ioredis";
import type { GuardrailMetrics } from "./metrics.js";

const KILL_SWITCH_KEY = "guardrail:kill-switch";

/**
 * Check whether the operator kill switch is active.
 * The kill switch is a simple Redis key set to "on".
 */
export async function isKillSwitchActive(
	redis: Redis,
	metrics: GuardrailMetrics,
): Promise<boolean> {
	const value = await redis.get(KILL_SWITCH_KEY);
	const active = value === "on";
	metrics.updateKillSwitch(active);
	return active;
}

/**
 * Set or clear the kill switch.
 * Operators use this via redis-cli: SET guardrail:kill-switch on
 */
export async function setKillSwitch(redis: Redis, active: boolean): Promise<void> {
	if (active) {
		await redis.set(KILL_SWITCH_KEY, "on");
	} else {
		await redis.del(KILL_SWITCH_KEY);
	}
}
