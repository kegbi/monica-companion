import type Redis from "ioredis";

const DEDUP_TTL_SECONDS = 60;
const KEY_PREFIX = "tg:dedup:";

/**
 * Tracks Telegram update_ids in Redis to prevent duplicate processing.
 * Degrades gracefully when Redis is unavailable (prefers availability over strict dedup).
 */
export class UpdateDedup {
	constructor(private readonly redis: Redis) {}

	async isDuplicate(updateId: number): Promise<boolean> {
		try {
			const key = `${KEY_PREFIX}${updateId}`;
			const result = await this.redis.set(key, "1", "EX", DEDUP_TTL_SECONDS, "NX");
			// result is "OK" if the key was set (new), null if it already existed (duplicate)
			return result === null;
		} catch {
			// Redis unavailable: fall back to processing (availability over strict dedup)
			return false;
		}
	}
}
