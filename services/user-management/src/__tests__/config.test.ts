import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

// 32-byte key encoded as hex (64 hex chars)
const TEST_ENCRYPTION_KEY = randomBytes(32).toString("hex");

const baseEnv = {
	SERVICE_NAME: "user-management" as const,
	JWT_SECRET: "test-jwt-secret",
	DATABASE_URL: "postgresql://monica:monica_dev@localhost:5432/monica_companion",
	SETUP_TOKEN_SECRET: "test-setup-token-secret-32-bytes!",
	SETUP_BASE_URL: "http://localhost",
	ENCRYPTION_MASTER_KEY: TEST_ENCRYPTION_KEY,
};

describe("loadConfig", () => {
	it("parses valid env", () => {
		const config = loadConfig(baseEnv);
		expect(config.port).toBe(3007);
		expect(config.databaseUrl).toBe(baseEnv.DATABASE_URL);
		expect(config.setupTokenSecret).toBe(baseEnv.SETUP_TOKEN_SECRET);
		expect(config.setupBaseUrl).toBe("http://localhost");
		expect(config.setupTokenTtlMinutes).toBe(15);
		expect(config.auth.serviceName).toBe("user-management");
		expect(config.auth.jwtSecrets).toEqual(["test-jwt-secret"]);
	});

	it("applies defaults for optional fields", () => {
		const config = loadConfig(baseEnv);
		expect(config.port).toBe(3007);
		expect(config.setupTokenTtlMinutes).toBe(15);
	});

	it("throws when DATABASE_URL is missing", () => {
		const { DATABASE_URL, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("throws when SETUP_TOKEN_SECRET is missing", () => {
		const { SETUP_TOKEN_SECRET, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("throws when SETUP_TOKEN_SECRET is too short", () => {
		expect(() => loadConfig({ ...baseEnv, SETUP_TOKEN_SECRET: "short" })).toThrow();
	});

	it("throws when SETUP_BASE_URL is missing", () => {
		const { SETUP_BASE_URL, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("coerces PORT correctly", () => {
		const config = loadConfig({ ...baseEnv, PORT: "8080" });
		expect(config.port).toBe(8080);
	});

	it("includes previous JWT secret when provided", () => {
		const config = loadConfig({ ...baseEnv, JWT_SECRET_PREVIOUS: "old-secret" });
		expect(config.auth.jwtSecrets).toEqual(["test-jwt-secret", "old-secret"]);
	});

	it("throws when ENCRYPTION_MASTER_KEY is missing", () => {
		const { ENCRYPTION_MASTER_KEY, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("throws when ENCRYPTION_MASTER_KEY is too short", () => {
		expect(() => loadConfig({ ...baseEnv, ENCRYPTION_MASTER_KEY: "short" })).toThrow();
	});

	it("parses ENCRYPTION_MASTER_KEY as hex into a 32-byte Buffer", () => {
		const config = loadConfig(baseEnv);
		expect(config.encryptionMasterKey).toBeInstanceOf(Buffer);
		expect(config.encryptionMasterKey.length).toBe(32);
	});

	it("parses ENCRYPTION_MASTER_KEY as base64url into a 32-byte Buffer", () => {
		const key = randomBytes(32).toString("base64url");
		const config = loadConfig({ ...baseEnv, ENCRYPTION_MASTER_KEY: key });
		expect(config.encryptionMasterKey).toBeInstanceOf(Buffer);
		expect(config.encryptionMasterKey.length).toBe(32);
	});

	it("sets encryptionMasterKeyPrevious to null when not provided", () => {
		const config = loadConfig(baseEnv);
		expect(config.encryptionMasterKeyPrevious).toBeNull();
	});

	it("parses ENCRYPTION_MASTER_KEY_PREVIOUS when provided", () => {
		const previousKey = randomBytes(32).toString("hex");
		const config = loadConfig({ ...baseEnv, ENCRYPTION_MASTER_KEY_PREVIOUS: previousKey });
		expect(config.encryptionMasterKeyPrevious).toBeInstanceOf(Buffer);
		expect(config.encryptionMasterKeyPrevious?.length).toBe(32);
	});
});
