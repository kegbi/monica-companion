import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

const validEnv = {
	PORT: "3005",
	DATABASE_URL: "postgresql://test:test@localhost:5432/test",
	REDIS_URL: "redis://localhost:6379",
	SERVICE_NAME: "scheduler",
	JWT_SECRET: "test-secret-key-minimum-length-32",
	MONICA_INTEGRATION_URL: "http://localhost:3004",
	DELIVERY_URL: "http://localhost:3006",
	USER_MANAGEMENT_URL: "http://localhost:3007",
};

describe("loadConfig", () => {
	it("parses valid environment", () => {
		const config = loadConfig(validEnv);
		expect(config.port).toBe(3005);
		expect(config.databaseUrl).toBe(validEnv.DATABASE_URL);
		expect(config.redisUrl).toBe(validEnv.REDIS_URL);
		expect(config.monicaIntegrationUrl).toBe(validEnv.MONICA_INTEGRATION_URL);
		expect(config.deliveryUrl).toBe(validEnv.DELIVERY_URL);
		expect(config.userManagementUrl).toBe(validEnv.USER_MANAGEMENT_URL);
	});

	it("applies defaults for optional fields", () => {
		const config = loadConfig(validEnv);
		expect(config.maxRetries).toBe(3);
		expect(config.retryBackoffMs).toBe(1000);
		expect(config.catchUpWindowHours).toBe(6);
		expect(config.reminderPollIntervalMs).toBe(60_000);
		expect(config.httpTimeoutMs).toBe(10_000);
	});

	it("throws on missing DATABASE_URL", () => {
		const { DATABASE_URL: _, ...env } = validEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("throws on missing REDIS_URL", () => {
		const { REDIS_URL: _, ...env } = validEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("throws on missing JWT_SECRET", () => {
		const { JWT_SECRET: _, ...env } = validEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("throws on missing MONICA_INTEGRATION_URL", () => {
		const { MONICA_INTEGRATION_URL: _, ...env } = validEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("accepts custom retry config", () => {
		const config = loadConfig({
			...validEnv,
			SCHEDULER_MAX_RETRIES: "5",
			SCHEDULER_RETRY_BACKOFF_MS: "2000",
			CATCH_UP_WINDOW_HOURS: "12",
			HTTP_TIMEOUT_MS: "15000",
		});
		expect(config.maxRetries).toBe(5);
		expect(config.retryBackoffMs).toBe(2000);
		expect(config.catchUpWindowHours).toBe(12);
		expect(config.httpTimeoutMs).toBe(15_000);
	});
});
