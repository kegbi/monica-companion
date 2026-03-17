import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

const baseEnv: Record<string, string> = {
	SERVICE_NAME: "delivery",
	JWT_SECRET: "test-secret-256-bit-minimum-key!",
	TELEGRAM_BRIDGE_URL: "http://telegram-bridge:3001",
	DATABASE_URL: "postgresql://monica:monica_dev@localhost:5432/monica_companion",
};

describe("loadConfig", () => {
	it("throws when DATABASE_URL is missing", () => {
		const { DATABASE_URL, ...envWithoutDb } = baseEnv;
		expect(() => loadConfig(envWithoutDb)).toThrow();
	});

	it("throws when TELEGRAM_BRIDGE_URL is missing", () => {
		const { TELEGRAM_BRIDGE_URL, ...envWithoutTg } = baseEnv;
		expect(() => loadConfig(envWithoutTg)).toThrow();
	});

	it("defaults httpTimeoutMs to 10000", () => {
		const config = loadConfig(baseEnv);
		expect(config.httpTimeoutMs).toBe(10_000);
	});

	it("parses custom HTTP_TIMEOUT_MS", () => {
		const config = loadConfig({ ...baseEnv, HTTP_TIMEOUT_MS: "5000" });
		expect(config.httpTimeoutMs).toBe(5000);
	});

	it("parses DATABASE_URL", () => {
		const config = loadConfig(baseEnv);
		expect(config.databaseUrl).toBe(
			"postgresql://monica:monica_dev@localhost:5432/monica_companion",
		);
	});

	it("parses TELEGRAM_BRIDGE_URL", () => {
		const config = loadConfig(baseEnv);
		expect(config.telegramBridgeUrl).toBe("http://telegram-bridge:3001");
	});
});
