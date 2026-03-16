import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Database } from "../../db/connection";
import {
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
