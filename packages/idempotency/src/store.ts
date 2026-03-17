import { sql } from "drizzle-orm";

export interface CheckResult {
	status: "in_progress" | "completed";
	result?: unknown;
}

export interface ClaimResult {
	claimed: boolean;
}

/**
 * PostgreSQL-backed idempotency store.
 *
 * Provides check/claim/complete/release operations for idempotent
 * request processing. Expired in_progress keys are reclaimable
 * to guard against crashed workers.
 */
export class IdempotencyStore {
	constructor(private readonly db: { execute: (query: unknown) => Promise<unknown[]> }) {}

	/**
	 * Check whether an idempotency key exists and its current status.
	 * Returns null if the key has never been seen.
	 */
	async check(key: string): Promise<CheckResult | null> {
		const rows = (await this.db.execute(
			sql`SELECT status, result FROM idempotency_keys WHERE key = ${key}`,
		)) as Array<{ status: string; result: unknown }>;

		if (rows.length === 0) {
			return null;
		}

		const row = rows[0];
		if (row.status === "completed") {
			return { status: "completed", result: row.result };
		}

		return { status: "in_progress" };
	}

	/**
	 * Atomically claim an idempotency key. Uses INSERT ... ON CONFLICT DO NOTHING
	 * pattern. If the key is already claimed and not expired, returns claimed: false.
	 * Expired in_progress keys are reclaimable.
	 */
	async claim(key: string, ttlMs: number): Promise<ClaimResult> {
		const expiresAt = new Date(Date.now() + ttlMs).toISOString();

		// First try to reclaim expired in_progress keys
		const reclaimed = (await this.db.execute(
			sql`UPDATE idempotency_keys
				SET status = 'in_progress', claimed_at = NOW(), expires_at = ${expiresAt}
				WHERE key = ${key} AND status = 'in_progress' AND expires_at < NOW()
				RETURNING key`,
		)) as Array<{ key: string }>;

		if (reclaimed.length > 0) {
			return { claimed: true };
		}

		// Try to insert a new key
		const inserted = (await this.db.execute(
			sql`INSERT INTO idempotency_keys (key, status, claimed_at, expires_at)
				VALUES (${key}, 'in_progress', NOW(), ${expiresAt})
				ON CONFLICT (key) DO NOTHING
				RETURNING key`,
		)) as Array<{ key: string }>;

		return { claimed: inserted.length > 0 };
	}

	/**
	 * Mark an in_progress key as completed with a stored result.
	 */
	async complete(key: string, result: unknown): Promise<void> {
		await this.db.execute(
			sql`UPDATE idempotency_keys
				SET status = 'completed', completed_at = NOW(), result = ${JSON.stringify(result)}::jsonb
				WHERE key = ${key} AND status = 'in_progress'`,
		);
	}

	/**
	 * Remove an in_progress claim. Used for cleanup when a job fails
	 * before reaching the dead-letter queue, allowing the key to be reclaimed.
	 */
	async release(key: string): Promise<void> {
		await this.db.execute(
			sql`DELETE FROM idempotency_keys WHERE key = ${key} AND status = 'in_progress'`,
		);
	}
}
