import { and, eq, gt, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { setupTokenAuditLog, setupTokens } from "../db/schema";

export interface IssueTokenParams {
	tokenId: string;
	telegramUserId: string;
	step: string;
	expiresAt: Date;
	correlationId?: string;
	actorService: string;
}

export interface ConsumeTokenParams {
	tokenId: string;
	correlationId?: string;
	actorService: string;
	ipAddress?: string;
}

export interface CancelTokenParams {
	telegramUserId: string;
	correlationId?: string;
	actorService: string;
}

export interface AuditEventParams {
	tokenId: string;
	event: string;
	actorService: string;
	ipAddress?: string;
	correlationId?: string;
}

export interface ConsumeResult {
	consumed: boolean;
	reason?: string;
}

export interface CancelResult {
	cancelled: boolean;
}

export async function issueToken(db: Database, params: IssueTokenParams) {
	return db.transaction(async (tx) => {
		// Supersede any existing active tokens for this user
		const existingTokens = await tx
			.update(setupTokens)
			.set({
				status: "superseded",
				invalidatedAt: new Date(),
			})
			.where(
				and(
					eq(setupTokens.telegramUserId, params.telegramUserId),
					eq(setupTokens.status, "active"),
				),
			)
			.returning({ id: setupTokens.id });

		// Log superseded events for each invalidated token
		for (const existing of existingTokens) {
			await tx.insert(setupTokenAuditLog).values({
				tokenId: existing.id,
				event: "superseded_by_reissue",
				actorService: params.actorService,
				correlationId: params.correlationId,
			});
		}

		// Insert the new token
		const [newToken] = await tx
			.insert(setupTokens)
			.values({
				id: params.tokenId,
				telegramUserId: params.telegramUserId,
				step: params.step,
				expiresAt: params.expiresAt,
			})
			.returning();

		// Log the issued event
		await tx.insert(setupTokenAuditLog).values({
			tokenId: newToken.id,
			event: "issued",
			actorService: params.actorService,
			correlationId: params.correlationId,
		});

		return newToken;
	});
}

export async function findActiveToken(db: Database, tokenId: string) {
	const results = await db
		.select()
		.from(setupTokens)
		.where(
			and(
				eq(setupTokens.id, tokenId),
				eq(setupTokens.status, "active"),
				gt(setupTokens.expiresAt, sql`now()`),
			),
		)
		.limit(1);

	return results[0] ?? null;
}

export async function findTokenById(db: Database, tokenId: string) {
	const results = await db.select().from(setupTokens).where(eq(setupTokens.id, tokenId)).limit(1);

	return results[0] ?? null;
}

export async function consumeToken(
	db: Database,
	params: ConsumeTokenParams,
): Promise<ConsumeResult> {
	return db.transaction(async (tx) => {
		// Look up the token to determine the reason for failure if needed
		const [token] = await tx
			.select()
			.from(setupTokens)
			.where(eq(setupTokens.id, params.tokenId))
			.limit(1);

		if (!token) {
			return { consumed: false, reason: "not_found" };
		}

		if (token.status === "consumed") {
			await tx.insert(setupTokenAuditLog).values({
				tokenId: params.tokenId,
				event: "replay_rejected",
				actorService: params.actorService,
				ipAddress: params.ipAddress,
				correlationId: params.correlationId,
			});
			return { consumed: false, reason: "already_consumed" };
		}

		if (token.status !== "active") {
			return { consumed: false, reason: `token_${token.status}` };
		}

		if (token.expiresAt <= new Date()) {
			await tx.insert(setupTokenAuditLog).values({
				tokenId: params.tokenId,
				event: "expired_rejected",
				actorService: params.actorService,
				ipAddress: params.ipAddress,
				correlationId: params.correlationId,
			});
			return { consumed: false, reason: "expired" };
		}

		// Atomically consume the token
		const updated = await tx
			.update(setupTokens)
			.set({
				status: "consumed",
				consumedAt: new Date(),
			})
			.where(
				and(
					eq(setupTokens.id, params.tokenId),
					eq(setupTokens.status, "active"),
					gt(setupTokens.expiresAt, sql`now()`),
				),
			)
			.returning();

		if (updated.length === 0) {
			return { consumed: false, reason: "race_condition" };
		}

		await tx.insert(setupTokenAuditLog).values({
			tokenId: params.tokenId,
			event: "consumed",
			actorService: params.actorService,
			ipAddress: params.ipAddress,
			correlationId: params.correlationId,
		});

		return { consumed: true };
	});
}

export async function cancelToken(db: Database, params: CancelTokenParams): Promise<CancelResult> {
	return db.transaction(async (tx) => {
		const updated = await tx
			.update(setupTokens)
			.set({
				status: "cancelled",
				invalidatedAt: new Date(),
			})
			.where(
				and(
					eq(setupTokens.telegramUserId, params.telegramUserId),
					eq(setupTokens.status, "active"),
				),
			)
			.returning({ id: setupTokens.id });

		if (updated.length === 0) {
			return { cancelled: false };
		}

		for (const token of updated) {
			await tx.insert(setupTokenAuditLog).values({
				tokenId: token.id,
				event: "cancelled",
				actorService: params.actorService,
				correlationId: params.correlationId,
			});
		}

		return { cancelled: true };
	});
}

export async function logAuditEvent(db: Database, params: AuditEventParams): Promise<void> {
	await db.insert(setupTokenAuditLog).values({
		tokenId: params.tokenId,
		event: params.event,
		actorService: params.actorService,
		ipAddress: params.ipAddress,
		correlationId: params.correlationId,
	});
}
