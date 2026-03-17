import Redis from "ioredis";

export type { Redis };

/**
 * Create an ioredis client from a connection URL.
 * Includes reconnect strategy and connection error logging.
 */
export function createRedisClient(url: string): Redis {
	const client = new Redis(url, {
		maxRetriesPerRequest: 3,
		retryStrategy(times: number) {
			// Exponential backoff capped at 5 seconds
			return Math.min(times * 200, 5000);
		},
		lazyConnect: false,
	});

	return client;
}

/**
 * Gracefully shut down a Redis client.
 */
export async function closeRedisClient(client: Redis): Promise<void> {
	await client.quit();
}
