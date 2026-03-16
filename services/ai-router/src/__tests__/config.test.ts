import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

const baseEnv = {
	SERVICE_NAME: "ai-router" as const,
	JWT_SECRET: "test-jwt-secret",
	DATABASE_URL: "postgresql://monica:monica_dev@localhost:5432/monica_companion",
	MONICA_INTEGRATION_URL: "http://monica-integration:3004",
};

describe("loadConfig", () => {
	it("parses valid env", () => {
		const config = loadConfig(baseEnv);
		expect(config.port).toBe(3002);
		expect(config.databaseUrl).toBe(baseEnv.DATABASE_URL);
		expect(config.auth.serviceName).toBe("ai-router");
		expect(config.auth.jwtSecrets).toEqual(["test-jwt-secret"]);
	});

	it("applies default port", () => {
		const config = loadConfig(baseEnv);
		expect(config.port).toBe(3002);
	});

	it("applies default pending command TTL", () => {
		const config = loadConfig(baseEnv);
		expect(config.pendingCommandTtlMinutes).toBe(30);
	});

	it("applies default expiry sweep interval", () => {
		const config = loadConfig(baseEnv);
		expect(config.expirySweepIntervalMs).toBe(60000);
	});

	it("throws when DATABASE_URL is missing", () => {
		const { DATABASE_URL, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("coerces PORT correctly", () => {
		const config = loadConfig({ ...baseEnv, PORT: "8080" });
		expect(config.port).toBe(8080);
	});

	it("coerces PENDING_COMMAND_TTL_MINUTES correctly", () => {
		const config = loadConfig({ ...baseEnv, PENDING_COMMAND_TTL_MINUTES: "15" });
		expect(config.pendingCommandTtlMinutes).toBe(15);
	});

	it("coerces EXPIRY_SWEEP_INTERVAL_MS correctly", () => {
		const config = loadConfig({ ...baseEnv, EXPIRY_SWEEP_INTERVAL_MS: "30000" });
		expect(config.expirySweepIntervalMs).toBe(30000);
	});

	it("includes previous JWT secret when provided", () => {
		const config = loadConfig({ ...baseEnv, JWT_SECRET_PREVIOUS: "old-secret" });
		expect(config.auth.jwtSecrets).toEqual(["test-jwt-secret", "old-secret"]);
	});

	it("parses MONICA_INTEGRATION_URL", () => {
		const config = loadConfig(baseEnv);
		expect(config.monicaIntegrationUrl).toBe("http://monica-integration:3004");
	});

	it("throws when MONICA_INTEGRATION_URL is missing", () => {
		const { MONICA_INTEGRATION_URL, ...env } = baseEnv;
		expect(() => loadConfig(env)).toThrow();
	});
});
