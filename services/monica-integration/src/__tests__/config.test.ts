import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

const validEnv = {
	PORT: "3004",
	SERVICE_NAME: "monica-integration",
	JWT_SECRET: "test-secret-at-least-1-char",
	USER_MANAGEMENT_URL: "http://user-management:3007",
};

describe("loadConfig", () => {
	it("parses valid env into typed config", () => {
		const config = loadConfig(validEnv);

		expect(config.port).toBe(3004);
		expect(config.userManagementUrl).toBe("http://user-management:3007");
		expect(config.monicaDefaultTimeoutMs).toBe(10000);
		expect(config.monicaRetryMax).toBe(2);
		expect(config.auth.serviceName).toBe("monica-integration");
		expect(config.auth.jwtSecrets).toContain("test-secret-at-least-1-char");
	});

	it("throws when required JWT_SECRET is missing", () => {
		const { JWT_SECRET, ...env } = validEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("throws when USER_MANAGEMENT_URL is missing", () => {
		const { USER_MANAGEMENT_URL, ...env } = validEnv;
		expect(() => loadConfig(env)).toThrow();
	});

	it("applies default PORT", () => {
		const { PORT, ...env } = validEnv;
		const config = loadConfig(env);
		expect(config.port).toBe(3004);
	});

	it("applies default timeout and retry", () => {
		const config = loadConfig(validEnv);
		expect(config.monicaDefaultTimeoutMs).toBe(10000);
		expect(config.monicaRetryMax).toBe(2);
	});

	it("allows custom timeout and retry", () => {
		const config = loadConfig({
			...validEnv,
			MONICA_DEFAULT_TIMEOUT_MS: "5000",
			MONICA_RETRY_MAX: "1",
		});
		expect(config.monicaDefaultTimeoutMs).toBe(5000);
		expect(config.monicaRetryMax).toBe(1);
	});

	it("includes previous JWT secret when provided", () => {
		const config = loadConfig({
			...validEnv,
			JWT_SECRET_PREVIOUS: "old-secret",
		});
		expect(config.auth.jwtSecrets).toHaveLength(2);
		expect(config.auth.jwtSecrets[1]).toBe("old-secret");
	});
});
