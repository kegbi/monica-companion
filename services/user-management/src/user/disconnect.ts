import { and, eq } from "drizzle-orm";
import type { Database } from "../db/connection";
import { credentialAccessAuditLog, dataPurgeRequests, setupTokens, users } from "../db/schema";

const PURGE_GRACE_DAYS = 30;

export interface DisconnectParams {
	userId: string;
	actorService: string;
	correlationId: string | null;
}

export interface DisconnectResult {
	purgeScheduledAt: Date;
}

/**
 * Disconnects a user by revoking credentials and scheduling data purge.
 * All operations are wrapped in a single database transaction.
 *
 * Returns null if user not found.
 */
export async function disconnectUser(
	db: Database,
	params: DisconnectParams,
): Promise<DisconnectResult | null> {
	const { userId, actorService, correlationId } = params;

	return db.transaction(async (tx) => {
		// 1. Find user
		const userRows = await tx.select().from(users).where(eq(users.id, userId)).limit(1);

		if (userRows.length === 0) {
			return null;
		}

		const user = userRows[0];
		const now = new Date();
		const purgeAfter = new Date(now.getTime() + PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000);

		// 2. Revoke credentials immediately
		await tx
			.update(users)
			.set({
				monicaApiTokenEncrypted: "",
				encryptionKeyId: "revoked",
				monicaBaseUrl: "revoked",
				updatedAt: now,
			})
			.where(eq(users.id, userId));

		// 3. Invalidate active setup tokens
		await tx
			.update(setupTokens)
			.set({
				status: "invalidated",
				invalidatedAt: now,
			})
			.where(
				and(eq(setupTokens.telegramUserId, user.telegramUserId), eq(setupTokens.status, "active")),
			);

		// 4. Schedule data purge
		await tx.insert(dataPurgeRequests).values({
			userId,
			reason: "account_disconnection",
			purgeAfter,
		});

		// 5. Audit log
		await tx.insert(credentialAccessAuditLog).values({
			userId,
			actorService,
			correlationId,
		});

		return { purgeScheduledAt: purgeAfter };
	});
}
