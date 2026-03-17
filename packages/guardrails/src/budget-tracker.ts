import type Redis from "ioredis";
import type { GuardrailMetrics } from "./metrics.js";

export interface BudgetCheckResult {
	allowed: boolean;
	currentSpendUsd: number;
	budgetLimitUsd: number;
	alarmTriggered: boolean;
}

/** Auto-expire after 35 days to self-clean monthly keys. */
const MONTHLY_KEY_TTL_SECONDS = 35 * 24 * 60 * 60;

function getMonthlyKey(): string {
	const now = new Date();
	const year = now.getUTCFullYear();
	const month = String(now.getUTCMonth() + 1).padStart(2, "0");
	return `guardrail:budget:${year}-${month}`;
}

/**
 * Check-before-increment budget tracker.
 * Cost is stored as integer cents to avoid floating-point drift.
 *
 * 1. GET current spend. If already >= limit, return allowed: false without INCRBY.
 * 2. INCRBY the cost. Re-check the post-increment value.
 * 3. Update OTel metrics.
 */
export async function recordAndCheckBudget(
	redis: Redis,
	costUsd: number,
	budgetLimitUsd: number,
	alarmThresholdPct: number,
	metrics: GuardrailMetrics,
): Promise<BudgetCheckResult> {
	const key = getMonthlyKey();
	const costCents = Math.round(costUsd * 100);
	const limitCents = Math.round(budgetLimitUsd * 100);
	const alarmCents = Math.round(limitCents * (alarmThresholdPct / 100));

	// Step 1: Check-before-increment
	const currentRaw = await redis.get(key);
	const currentCents = currentRaw ? Number.parseInt(currentRaw, 10) : 0;

	if (currentCents >= limitCents) {
		const spendUsd = currentCents / 100;
		metrics.updateBudgetSpend(spendUsd);
		metrics.updateBudgetLimit(budgetLimitUsd);
		metrics.recordBudgetExhaustion();
		metrics.updateBudgetAlarm(true);
		return {
			allowed: false,
			currentSpendUsd: spendUsd,
			budgetLimitUsd,
			alarmTriggered: true,
		};
	}

	// Step 2: Increment and check
	const newCents = await redis.incrby(key, costCents);
	await redis.expire(key, MONTHLY_KEY_TTL_SECONDS);

	const spendUsd = newCents / 100;
	const alarmTriggered = newCents >= alarmCents;
	const allowed = newCents <= limitCents;

	metrics.updateBudgetSpend(spendUsd);
	metrics.updateBudgetLimit(budgetLimitUsd);
	metrics.updateBudgetAlarm(alarmTriggered);

	if (!allowed) {
		metrics.recordBudgetExhaustion();
	}

	return {
		allowed,
		currentSpendUsd: spendUsd,
		budgetLimitUsd,
		alarmTriggered,
	};
}

/**
 * Get the current month's cumulative spend in USD.
 */
export async function getCurrentSpend(redis: Redis): Promise<number> {
	const key = getMonthlyKey();
	const raw = await redis.get(key);
	if (!raw) return 0;
	return Number.parseInt(raw, 10) / 100;
}
