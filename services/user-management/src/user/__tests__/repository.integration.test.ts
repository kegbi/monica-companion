import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Database } from "../../db/connection";
import {
	createOrUpdateUserFromOnboarding,
	createUser,
	findUserById,
	getDecryptedCredentials,
	getUserPreferences,
	getUserSchedule,
	logCredentialAccess,
} from "../repository";

const DATABASE_URL =
	process.env.DATABASE_URL ?? "postgresql://monica:monica_dev@localhost:5432/monica_companion";

let db: Database;

function generateMasterKey(): Buffer {
	return randomBytes(32);
}

beforeAll(async () => {
	db = createDb(DATABASE_URL);

	// Use migration-style table creation for proper FK ordering
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			telegram_user_id TEXT NOT NULL UNIQUE,
			monica_base_url TEXT NOT NULL,
			monica_api_token_encrypted TEXT NOT NULL,
			encryption_key_id TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS user_preferences (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL UNIQUE REFERENCES users(id),
			language TEXT NOT NULL DEFAULT 'en',
			confirmation_mode TEXT NOT NULL DEFAULT 'explicit',
			timezone TEXT NOT NULL,
			reminder_cadence TEXT NOT NULL DEFAULT 'daily',
			reminder_time TEXT NOT NULL DEFAULT '08:00',
			connector_type TEXT NOT NULL DEFAULT 'telegram',
			connector_routing_id TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await db.execute(sql`
		CREATE TABLE IF NOT EXISTS credential_access_audit_log (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES users(id),
			actor_service TEXT NOT NULL,
			correlation_id TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`);
	await db.execute(sql`
		CREATE INDEX IF NOT EXISTS idx_credential_audit_user_id
		ON credential_access_audit_log(user_id)
	`);
	await db.execute(sql`
		CREATE INDEX IF NOT EXISTS idx_credential_audit_created_at
		ON credential_access_audit_log(created_at)
	`);
});

beforeEach(async () => {
	await db.execute(sql`DELETE FROM credential_access_audit_log`);
	await db.execute(sql`DELETE FROM user_preferences`);
	await db.execute(sql`DELETE FROM users`);
});

afterAll(async () => {
	await db.execute(sql`DELETE FROM credential_access_audit_log`);
	await db.execute(sql`DELETE FROM user_preferences`);
	await db.execute(sql`DELETE FROM users`);
});

describe("findUserById", () => {
	it("returns null for nonexistent user", async () => {
		const result = await findUserById(db, randomUUID());
		expect(result).toBeNull();
	});

	it("returns user row for existing user", async () => {
		const masterKey = generateMasterKey();
		const user = await createUser(db, {
			telegramUserId: "tg-123",
			monicaBaseUrl: "https://monica.example.com",
			monicaApiToken: "secret-token",
			masterKey,
		});

		const result = await findUserById(db, user.id);
		expect(result).not.toBeNull();
		expect(result?.telegramUserId).toBe("tg-123");
		expect(result?.monicaBaseUrl).toBe("https://monica.example.com");
		// Encrypted token should not equal plaintext
		expect(result?.monicaApiTokenEncrypted).not.toBe("secret-token");
	});
});

describe("getDecryptedCredentials", () => {
	it("returns decrypted apiToken for an inserted user", async () => {
		const masterKey = generateMasterKey();
		const user = await createUser(db, {
			telegramUserId: "tg-decrypt-test",
			monicaBaseUrl: "https://monica.example.com",
			monicaApiToken: "my-secret-api-token",
			masterKey,
		});

		const creds = await getDecryptedCredentials(db, user.id, masterKey, null);
		expect(creds).not.toBeNull();
		expect(creds?.baseUrl).toBe("https://monica.example.com");
		expect(creds?.apiToken).toBe("my-secret-api-token");
	});

	it("returns null for nonexistent user", async () => {
		const masterKey = generateMasterKey();
		const creds = await getDecryptedCredentials(db, randomUUID(), masterKey, null);
		expect(creds).toBeNull();
	});

	it("handles key rotation: decrypts with previous key and signals re-encrypt", async () => {
		const previousKey = generateMasterKey();
		const user = await createUser(db, {
			telegramUserId: "tg-rotation-test",
			monicaBaseUrl: "https://monica.example.com",
			monicaApiToken: "rotation-secret",
			masterKey: previousKey,
		});

		const currentKey = generateMasterKey();
		const creds = await getDecryptedCredentials(db, user.id, currentKey, previousKey);
		expect(creds).not.toBeNull();
		expect(creds?.apiToken).toBe("rotation-secret");
	});
});

describe("logCredentialAccess", () => {
	it("creates audit record", async () => {
		const masterKey = generateMasterKey();
		const user = await createUser(db, {
			telegramUserId: "tg-audit-test",
			monicaBaseUrl: "https://monica.example.com",
			monicaApiToken: "audit-secret",
			masterKey,
		});

		await logCredentialAccess(db, {
			userId: user.id,
			actorService: "monica-integration",
			correlationId: "corr-123",
		});

		const rows = await db.execute(
			sql`SELECT * FROM credential_access_audit_log WHERE user_id = ${user.id}`,
		);
		expect(rows.length).toBe(1);
		expect(rows[0].actor_service).toBe("monica-integration");
		expect(rows[0].correlation_id).toBe("corr-123");
	});
});

describe("getUserPreferences", () => {
	it("returns null when user has no preferences", async () => {
		const masterKey = generateMasterKey();
		const user = await createUser(db, {
			telegramUserId: "tg-no-prefs",
			monicaBaseUrl: "https://monica.example.com",
			monicaApiToken: "secret",
			masterKey,
		});

		const prefs = await getUserPreferences(db, user.id);
		expect(prefs).toBeNull();
	});

	it("returns preferences for a user with preferences", async () => {
		const masterKey = generateMasterKey();
		const user = await createUser(db, {
			telegramUserId: "tg-with-prefs",
			monicaBaseUrl: "https://monica.example.com",
			monicaApiToken: "secret",
			masterKey,
			preferences: {
				timezone: "America/New_York",
				connectorRoutingId: "chat-123",
			},
		});

		const prefs = await getUserPreferences(db, user.id);
		expect(prefs).not.toBeNull();
		expect(prefs?.language).toBe("en");
		expect(prefs?.confirmationMode).toBe("explicit");
		expect(prefs?.timezone).toBe("America/New_York");
	});
});

describe("getUserSchedule", () => {
	it("returns null when user has no preferences", async () => {
		const masterKey = generateMasterKey();
		const user = await createUser(db, {
			telegramUserId: "tg-no-schedule",
			monicaBaseUrl: "https://monica.example.com",
			monicaApiToken: "secret",
			masterKey,
		});

		const schedule = await getUserSchedule(db, user.id);
		expect(schedule).toBeNull();
	});

	it("returns schedule fields for a user with preferences", async () => {
		const masterKey = generateMasterKey();
		const user = await createUser(db, {
			telegramUserId: "tg-with-schedule",
			monicaBaseUrl: "https://monica.example.com",
			monicaApiToken: "secret",
			masterKey,
			preferences: {
				timezone: "Europe/Berlin",
				connectorRoutingId: "chat-456",
				reminderCadence: "weekly",
				reminderTime: "09:30",
			},
		});

		const schedule = await getUserSchedule(db, user.id);
		expect(schedule).not.toBeNull();
		expect(schedule?.reminderCadence).toBe("weekly");
		expect(schedule?.reminderTime).toBe("09:30");
		expect(schedule?.timezone).toBe("Europe/Berlin");
		expect(schedule?.connectorType).toBe("telegram");
		expect(schedule?.connectorRoutingId).toBe("chat-456");
	});
});

describe("createOrUpdateUserFromOnboarding", () => {
	it("creates a new user with encrypted credentials and preferences", async () => {
		const masterKey = generateMasterKey();
		const result = await createOrUpdateUserFromOnboarding(db, {
			telegramUserId: "tg-onboard-new",
			monicaBaseUrl: "https://monica.example.com/api",
			monicaApiKey: "my-api-key",
			language: "en",
			confirmationMode: "explicit",
			timezone: "America/New_York",
			reminderCadence: "daily",
			reminderTime: "08:00",
			connectorRoutingId: "tg-onboard-new",
			masterKey,
		});

		expect(result.userId).toBeDefined();

		// Verify user row
		const user = await findUserById(db, result.userId);
		expect(user).not.toBeNull();
		expect(user?.telegramUserId).toBe("tg-onboard-new");
		expect(user?.monicaBaseUrl).toBe("https://monica.example.com/api");
		// Encrypted, not plaintext
		expect(user?.monicaApiTokenEncrypted).not.toBe("my-api-key");

		// Verify credentials can be decrypted
		const creds = await getDecryptedCredentials(db, result.userId, masterKey, null);
		expect(creds?.apiToken).toBe("my-api-key");

		// Verify preferences
		const prefs = await getUserPreferences(db, result.userId);
		expect(prefs).not.toBeNull();
		expect(prefs?.language).toBe("en");
		expect(prefs?.confirmationMode).toBe("explicit");
		expect(prefs?.timezone).toBe("America/New_York");
		expect(prefs?.reminderCadence).toBe("daily");
		expect(prefs?.reminderTime).toBe("08:00");
		expect(prefs?.connectorType).toBe("telegram");
		expect(prefs?.connectorRoutingId).toBe("tg-onboard-new");
	});

	it("updates existing user on re-setup (upsert)", async () => {
		const masterKey = generateMasterKey();

		// First onboarding
		const first = await createOrUpdateUserFromOnboarding(db, {
			telegramUserId: "tg-upsert-test",
			monicaBaseUrl: "https://old-monica.example.com/api",
			monicaApiKey: "old-key",
			language: "en",
			confirmationMode: "explicit",
			timezone: "America/New_York",
			reminderCadence: "daily",
			reminderTime: "08:00",
			connectorRoutingId: "tg-upsert-test",
			masterKey,
		});

		// Second onboarding (re-setup)
		const second = await createOrUpdateUserFromOnboarding(db, {
			telegramUserId: "tg-upsert-test",
			monicaBaseUrl: "https://new-monica.example.com/api",
			monicaApiKey: "new-key",
			language: "fr",
			confirmationMode: "auto",
			timezone: "Europe/Paris",
			reminderCadence: "weekly",
			reminderTime: "09:30",
			connectorRoutingId: "tg-upsert-test",
			masterKey,
		});

		// Same user ID (upsert, not duplicate)
		expect(second.userId).toBe(first.userId);

		// Verify updated credentials
		const creds = await getDecryptedCredentials(db, second.userId, masterKey, null);
		expect(creds?.baseUrl).toBe("https://new-monica.example.com/api");
		expect(creds?.apiToken).toBe("new-key");

		// Verify updated preferences
		const prefs = await getUserPreferences(db, second.userId);
		expect(prefs?.language).toBe("fr");
		expect(prefs?.confirmationMode).toBe("auto");
		expect(prefs?.timezone).toBe("Europe/Paris");
		expect(prefs?.reminderCadence).toBe("weekly");
		expect(prefs?.reminderTime).toBe("09:30");
	});

	it("uses custom connectorType when provided", async () => {
		const masterKey = generateMasterKey();
		const result = await createOrUpdateUserFromOnboarding(db, {
			telegramUserId: "tg-connector-test",
			monicaBaseUrl: "https://monica.example.com/api",
			monicaApiKey: "key",
			language: "en",
			confirmationMode: "explicit",
			timezone: "UTC",
			reminderCadence: "none",
			reminderTime: "08:00",
			connectorRoutingId: "tg-connector-test",
			connectorType: "telegram",
			masterKey,
		});

		const prefs = await getUserPreferences(db, result.userId);
		expect(prefs?.connectorType).toBe("telegram");
	});
});
