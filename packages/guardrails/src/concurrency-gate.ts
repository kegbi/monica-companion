import type Redis from "ioredis";
import type { GuardrailMetrics } from "./metrics.js";

export interface ConcurrencyGateResult {
	acquired: boolean;
	currentConcurrency: number;
}

const DEFAULT_TTL_SECONDS = 120;

/**
 * Redis-backed per-user concurrency semaphore.
 * Uses a sorted set where each member is a requestId scored by expiry timestamp.
 * Stale entries (past TTL) are cleaned before checking cardinality.
 */
export async function acquireConcurrency(
	redis: Redis,
	userId: string,
	modelType: string,
	requestId: string,
	maxConcurrency: number,
	metrics: GuardrailMetrics,
	service: string,
	ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<ConcurrencyGateResult> {
	const key = `guardrail:concurrency:${modelType}:${userId}`;
	const now = Date.now();
	const expiryScore = now + ttlSeconds * 1000;

	// Step 1: Clean stale entries and count current
	const checkPipeline = redis.multi();
	checkPipeline.zremrangebyscore(key, 0, now); // Remove expired entries
	checkPipeline.zcard(key); // Count active entries

	const checkResults = await checkPipeline.exec();
	if (!checkResults) {
		metrics.recordConcurrencyRejection(modelType, service);
		return { acquired: false, currentConcurrency: 0 };
	}

	const currentCount = checkResults[1][1] as number;

	if (currentCount >= maxConcurrency) {
		metrics.recordConcurrencyRejection(modelType, service);
		return { acquired: false, currentConcurrency: currentCount };
	}

	// Step 2: Add the new entry
	const acquirePipeline = redis.multi();
	acquirePipeline.zadd(key, expiryScore.toString(), requestId);
	acquirePipeline.expire(key, ttlSeconds);
	await acquirePipeline.exec();

	return { acquired: true, currentConcurrency: currentCount + 1 };
}

/**
 * Release a concurrency slot by removing the request entry.
 */
export async function releaseConcurrency(
	redis: Redis,
	userId: string,
	modelType: string,
	requestId: string,
): Promise<void> {
	const key = `guardrail:concurrency:${modelType}:${userId}`;
	await redis.zrem(key, requestId);
}
