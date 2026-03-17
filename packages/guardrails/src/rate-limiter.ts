import type Redis from "ioredis";
import type { GuardrailMetrics } from "./metrics.js";

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetAtMs: number;
}

/**
 * Sliding window rate limiter using Redis sorted sets.
 * Each request is scored by its timestamp. Expired entries are pruned
 * before counting to maintain the window.
 */
export async function checkRateLimit(
	redis: Redis,
	userId: string,
	modelType: string,
	limit: number,
	windowSeconds: number,
	metrics: GuardrailMetrics,
	service: string,
): Promise<RateLimitResult> {
	const key = `guardrail:rate:${modelType}:${userId}`;
	const now = Date.now();
	const windowStart = now - windowSeconds * 1000;
	const resetAtMs = now + windowSeconds * 1000;

	// Atomic pipeline: remove expired, add current, count, set TTL
	const pipeline = redis.multi();
	pipeline.zremrangebyscore(key, 0, windowStart);
	pipeline.zadd(key, now.toString(), `${now}:${Math.random().toString(36).slice(2, 8)}`);
	pipeline.zcard(key);
	pipeline.expire(key, windowSeconds);

	const results = await pipeline.exec();
	if (!results) {
		// Pipeline failed - fail closed
		metrics.recordRateLimitRejection(modelType, service);
		return { allowed: false, remaining: 0, resetAtMs };
	}

	// ZCARD result is at index 2 (after ZREMRANGEBYSCORE, ZADD)
	const count = results[2][1] as number;

	if (count > limit) {
		metrics.recordRateLimitRejection(modelType, service);
		return { allowed: false, remaining: 0, resetAtMs };
	}

	return {
		allowed: true,
		remaining: limit - count,
		resetAtMs,
	};
}
