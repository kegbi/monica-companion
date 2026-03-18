import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";

const baseEnv: Record<string, string> = {
	SERVICE_NAME: "delivery",
	JWT_SECRET: "test-secret-256-bit-minimum-key!",
	CONNECTOR_URL_TELEGRAM: "http://telegram-bridge:3001",
	DATABASE_URL: "postgresql://monica:monica_dev@localhost:5432/monica_companion",
};

describe("loadConfig", () => {
	it("throws when DATABASE_URL is missing", () => {
		const { DATABASE_URL, ...envWithoutDb } = baseEnv;
		expect(() => loadConfig(envWithoutDb)).toThrow();
	});

	it("throws when no CONNECTOR_URL_ env vars are present", () => {
		const { CONNECTOR_URL_TELEGRAM, ...envWithoutConnector } = baseEnv;
		expect(() => loadConfig(envWithoutConnector)).toThrow();
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

	it("builds connector registry from CONNECTOR_URL_ prefix env vars", () => {
		const config = loadConfig(baseEnv);
		expect(config.connectorRegistry.telegram).toBe("http://telegram-bridge:3001");
	});

	it("supports multiple connectors via prefix env vars", () => {
		const config = loadConfig({
			...baseEnv,
			CONNECTOR_URL_WHATSAPP: "http://whatsapp-bridge:3010",
		});
		expect(config.connectorRegistry.telegram).toBe("http://telegram-bridge:3001");
		expect(config.connectorRegistry.whatsapp).toBe("http://whatsapp-bridge:3010");
	});

	it("backward compat: TELEGRAM_BRIDGE_URL populates telegram registry entry", () => {
		const { CONNECTOR_URL_TELEGRAM, ...envWithOldVar } = baseEnv;
		const config = loadConfig({
			...envWithOldVar,
			TELEGRAM_BRIDGE_URL: "http://telegram-bridge:3001",
		});
		expect(config.connectorRegistry.telegram).toBe("http://telegram-bridge:3001");
	});

	it("derives connector audience from connectorType", () => {
		const config = loadConfig(baseEnv);
		expect(config.connectorAudience("telegram")).toBe("telegram-bridge");
	});
});
