import { z } from "zod/v4";

const guardrailConfigSchema = z.object({
	REDIS_URL: z.string().min(1),
	GUARDRAIL_RATE_LIMIT_PER_USER: z.coerce.number().int().positive().default(30),
	GUARDRAIL_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
	GUARDRAIL_CONCURRENCY_PER_USER: z.coerce.number().int().positive().default(3),
	GUARDRAIL_BUDGET_LIMIT_USD: z.coerce.number().positive().default(100),
	GUARDRAIL_BUDGET_ALARM_THRESHOLD_PCT: z.coerce.number().min(1).max(100).default(80),
	GUARDRAIL_COST_PER_REQUEST_USD: z.coerce.number().positive().default(0.01),
});

export interface GuardrailConfig {
	redisUrl: string;
	rateLimitPerUser: number;
	rateWindowSeconds: number;
	concurrencyPerUser: number;
	budgetLimitUsd: number;
	budgetAlarmThresholdPct: number;
	costPerRequestUsd: number;
}

export function loadGuardrailConfig(
	env: Record<string, string | undefined> = process.env,
): GuardrailConfig {
	const parsed = guardrailConfigSchema.parse(env);
	return {
		redisUrl: parsed.REDIS_URL,
		rateLimitPerUser: parsed.GUARDRAIL_RATE_LIMIT_PER_USER,
		rateWindowSeconds: parsed.GUARDRAIL_RATE_WINDOW_SECONDS,
		concurrencyPerUser: parsed.GUARDRAIL_CONCURRENCY_PER_USER,
		budgetLimitUsd: parsed.GUARDRAIL_BUDGET_LIMIT_USD,
		budgetAlarmThresholdPct: parsed.GUARDRAIL_BUDGET_ALARM_THRESHOLD_PCT,
		costPerRequestUsd: parsed.GUARDRAIL_COST_PER_REQUEST_USD,
	};
}
