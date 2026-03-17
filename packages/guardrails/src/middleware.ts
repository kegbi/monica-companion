import { getCorrelationId, getUserId } from "@monica-companion/auth";
import type { Context, MiddlewareHandler } from "hono";
import type Redis from "ioredis";
import { recordAndCheckBudget } from "./budget-tracker.js";
import { acquireConcurrency, releaseConcurrency } from "./concurrency-gate.js";
import { isKillSwitchActive } from "./kill-switch.js";
import type { GuardrailMetrics } from "./metrics.js";
import { checkRateLimit } from "./rate-limiter.js";

export interface GuardrailMiddlewareOptions {
	redis: Redis;
	modelType: string;
	rateLimit: number;
	rateWindowSeconds: number;
	maxConcurrency: number;
	budgetLimitUsd: number;
	budgetAlarmThresholdPct: number;
	costEstimator: (c: Context) => number;
	metrics: GuardrailMetrics;
	service: string;
}

/**
 * Hono middleware that composes all guardrail checks.
 *
 * Check order (cheapest first):
 * 1. userId presence (required for per-user limits)
 * 2. Kill switch (single Redis GET)
 * 3. Rate limit (sorted set pipeline)
 * 4. Budget check (GET + conditional INCRBY)
 * 5. Concurrency acquire (sorted set pipeline)
 *
 * On handler completion (success or failure), releases the concurrency semaphore.
 * On Redis failure, fails closed with 503.
 */
export function guardrailMiddleware(options: GuardrailMiddlewareOptions): MiddlewareHandler {
	const {
		redis,
		modelType,
		rateLimit,
		rateWindowSeconds,
		maxConcurrency,
		budgetLimitUsd,
		budgetAlarmThresholdPct,
		costEstimator,
		metrics,
		service,
	} = options;

	return async (c, next) => {
		// Step 1: Require userId (MEDIUM-1 from plan review)
		const userId = getUserId(c);
		if (!userId) {
			return c.json(
				{
					error: "missing_user_id",
					message: "Request must include an authenticated user identity.",
				},
				400,
			);
		}

		// Obtain requestId for concurrency tracking
		let requestId: string;
		try {
			requestId = getCorrelationId(c);
		} catch {
			requestId = crypto.randomUUID();
		}

		try {
			// Step 2: Kill switch check
			const killSwitchOn = await isKillSwitchActive(redis, metrics);
			if (killSwitchOn) {
				metrics.recordKillSwitchRejection(service);
				return c.json(
					{
						error: "service_degraded",
						message: "AI features are temporarily disabled. Please try again later.",
					},
					503,
				);
			}

			// Step 3: Rate limit check
			const rateLimitResult = await checkRateLimit(
				redis,
				userId,
				modelType,
				rateLimit,
				rateWindowSeconds,
				metrics,
				service,
			);
			if (!rateLimitResult.allowed) {
				const retryAfterMs = Math.max(0, rateLimitResult.resetAtMs - Date.now());
				return c.json(
					{
						error: "rate_limited",
						message: "You've sent too many requests. Please wait a moment and try again.",
						retryAfterMs,
					},
					429,
				);
			}

			// Step 4: Budget check
			const costUsd = costEstimator(c);
			const budgetResult = await recordAndCheckBudget(
				redis,
				costUsd,
				budgetLimitUsd,
				budgetAlarmThresholdPct,
				metrics,
			);
			if (!budgetResult.allowed) {
				return c.json(
					{
						error: "budget_exhausted",
						message: "AI features are temporarily unavailable. The operator has been notified.",
					},
					503,
				);
			}

			// Step 5: Concurrency acquire
			const concurrencyResult = await acquireConcurrency(
				redis,
				userId,
				modelType,
				requestId,
				maxConcurrency,
				metrics,
				service,
			);
			if (!concurrencyResult.acquired) {
				return c.json(
					{
						error: "concurrency_exceeded",
						message:
							"Your previous request is still being processed. Please wait for it to complete.",
					},
					429,
				);
			}

			// All checks passed
			metrics.recordRequestAllowed(modelType, service);

			try {
				await next();
			} finally {
				// Always release concurrency, even on handler error
				await releaseConcurrency(redis, userId, modelType, requestId);
			}
		} catch {
			// Redis failure or unexpected error - fail closed
			return c.json(
				{
					error: "service_degraded",
					message: "AI features are temporarily disabled. Please try again later.",
				},
				503,
			);
		}
	};
}
