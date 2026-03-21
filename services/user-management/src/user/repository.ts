import { eq, ne } from "drizzle-orm";
import {
	computeKeyId,
	encryptCredential,
	tryDecryptWithRotation,
} from "../crypto/credential-cipher";
import type { Database } from "../db/connection";
import { credentialAccessAuditLog, userPreferences, users } from "../db/schema";

/** A Drizzle transaction or the database itself. */
export type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function findUserById(db: Database, userId: string) {
	const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
	return rows[0] ?? null;
}

export async function findUserByTelegramId(db: Database, telegramUserId: string) {
	const rows = await db
		.select()
		.from(users)
		.where(eq(users.telegramUserId, telegramUserId))
		.limit(1);
	return rows[0] ?? null;
}

export async function getDecryptedCredentials(
	db: Database,
	userId: string,
	masterKey: Buffer,
	previousMasterKey: Buffer | null,
): Promise<{ baseUrl: string; apiToken: string } | null> {
	const user = await findUserById(db, userId);
	if (!user) return null;

	const { plaintext } = tryDecryptWithRotation(
		user.monicaApiTokenEncrypted,
		masterKey,
		previousMasterKey,
	);

	return {
		baseUrl: user.monicaBaseUrl,
		apiToken: plaintext,
	};
}

export async function getUserPreferences(db: Database, userId: string) {
	const rows = await db
		.select()
		.from(userPreferences)
		.where(eq(userPreferences.userId, userId))
		.limit(1);
	return rows[0] ?? null;
}

export async function getUserSchedule(
	db: Database,
	userId: string,
): Promise<{
	reminderCadence: string;
	reminderTime: string;
	timezone: string;
	connectorType: string;
	connectorRoutingId: string;
} | null> {
	const prefs = await getUserPreferences(db, userId);
	if (!prefs) return null;

	return {
		reminderCadence: prefs.reminderCadence,
		reminderTime: prefs.reminderTime,
		timezone: prefs.timezone,
		connectorType: prefs.connectorType,
		connectorRoutingId: prefs.connectorRoutingId,
	};
}

/**
 * List all users with active reminder schedules (cadence != 'none').
 * Used by the scheduler to enumerate users for reminder polling.
 */
export async function listUsersWithSchedules(db: Database): Promise<
	Array<{
		userId: string;
		reminderCadence: string;
		reminderTime: string;
		timezone: string;
		connectorType: string;
		connectorRoutingId: string;
	}>
> {
	const rows = await db
		.select({
			userId: userPreferences.userId,
			reminderCadence: userPreferences.reminderCadence,
			reminderTime: userPreferences.reminderTime,
			timezone: userPreferences.timezone,
			connectorType: userPreferences.connectorType,
			connectorRoutingId: userPreferences.connectorRoutingId,
		})
		.from(userPreferences)
		.where(ne(userPreferences.reminderCadence, "none"));
	return rows;
}

export async function logCredentialAccess(
	db: Database,
	params: {
		userId: string;
		actorService: string;
		correlationId: string | null;
	},
) {
	await db.insert(credentialAccessAuditLog).values({
		userId: params.userId,
		actorService: params.actorService,
		correlationId: params.correlationId,
	});
}

/**
 * Create a user with encrypted credentials.
 * Used for test seeding and future onboarding flows.
 */
export async function createUser(
	db: Database,
	params: {
		telegramUserId: string;
		monicaBaseUrl: string;
		monicaApiToken: string;
		masterKey: Buffer;
		preferences?: {
			timezone: string;
			connectorRoutingId: string;
			language?: string;
			confirmationMode?: string;
			reminderCadence?: string;
			reminderTime?: string;
			connectorType?: string;
		};
	},
): Promise<{ id: string }> {
	const encrypted = encryptCredential(params.monicaApiToken, params.masterKey);
	const keyId = computeKeyId(params.masterKey);

	const [user] = await db
		.insert(users)
		.values({
			telegramUserId: params.telegramUserId,
			monicaBaseUrl: params.monicaBaseUrl,
			monicaApiTokenEncrypted: encrypted,
			encryptionKeyId: keyId,
		})
		.returning({ id: users.id });

	if (params.preferences) {
		await db.insert(userPreferences).values({
			userId: user.id,
			timezone: params.preferences.timezone,
			connectorRoutingId: params.preferences.connectorRoutingId,
			language: params.preferences.language,
			confirmationMode: params.preferences.confirmationMode,
			reminderCadence: params.preferences.reminderCadence,
			reminderTime: params.preferences.reminderTime,
			connectorType: params.preferences.connectorType,
		});
	}

	return user;
}

export interface OnboardingUserParams {
	telegramUserId: string;
	monicaBaseUrl: string;
	monicaApiKey: string;
	language: string;
	confirmationMode: string;
	timezone: string;
	reminderCadence: string;
	reminderTime: string;
	connectorRoutingId: string;
	connectorType?: string;
	masterKey: Buffer;
}

/**
 * Create or update a user from onboarding data.
 * Upserts the users row (conflict on telegram_user_id) and
 * upserts the user_preferences row (conflict on user_id).
 *
 * Accepts an optional transaction parameter so it can join
 * an outer transaction (e.g., token consumption + user creation).
 */
export async function createOrUpdateUserFromOnboarding(
	dbOrTx: DbOrTx,
	params: OnboardingUserParams,
): Promise<{ userId: string }> {
	const encrypted = encryptCredential(params.monicaApiKey, params.masterKey);
	const keyId = computeKeyId(params.masterKey);
	const now = new Date();

	// Upsert user row (conflict on telegram_user_id unique constraint)
	const [user] = await dbOrTx
		.insert(users)
		.values({
			telegramUserId: params.telegramUserId,
			monicaBaseUrl: params.monicaBaseUrl,
			monicaApiTokenEncrypted: encrypted,
			encryptionKeyId: keyId,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: users.telegramUserId,
			set: {
				monicaBaseUrl: params.monicaBaseUrl,
				monicaApiTokenEncrypted: encrypted,
				encryptionKeyId: keyId,
				updatedAt: now,
			},
		})
		.returning({ id: users.id });

	// Upsert preferences row (conflict on user_id unique constraint)
	await dbOrTx
		.insert(userPreferences)
		.values({
			userId: user.id,
			language: params.language,
			confirmationMode: params.confirmationMode,
			timezone: params.timezone,
			reminderCadence: params.reminderCadence,
			reminderTime: params.reminderTime,
			connectorType: params.connectorType ?? "telegram",
			connectorRoutingId: params.connectorRoutingId,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: userPreferences.userId,
			set: {
				language: params.language,
				confirmationMode: params.confirmationMode,
				timezone: params.timezone,
				reminderCadence: params.reminderCadence,
				reminderTime: params.reminderTime,
				connectorType: params.connectorType ?? "telegram",
				connectorRoutingId: params.connectorRoutingId,
				updatedAt: now,
			},
		});

	return { userId: user.id };
}
