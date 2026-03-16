import { describe, expect, it } from "vitest";
import { createLogger } from "../logger";

describe("createLogger", () => {
	it("creates a logger with info method that does not throw", () => {
		const logger = createLogger("test-logger");
		expect(() => logger.info("test message")).not.toThrow();
	});

	it("creates a logger with warn method that does not throw", () => {
		const logger = createLogger("test-logger");
		expect(() => logger.warn("test warning")).not.toThrow();
	});

	it("creates a logger with error method that does not throw", () => {
		const logger = createLogger("test-logger");
		expect(() => logger.error("test error")).not.toThrow();
	});

	it("creates a logger with debug method that does not throw", () => {
		const logger = createLogger("test-logger");
		expect(() => logger.debug("test debug")).not.toThrow();
	});

	it("accepts structured data as second argument", () => {
		const logger = createLogger("test-logger");
		expect(() => logger.info("test message", { key: "val", count: 42 })).not.toThrow();
	});

	it("returns an object with all four log methods", () => {
		const logger = createLogger("test-logger");
		expect(typeof logger.info).toBe("function");
		expect(typeof logger.warn).toBe("function");
		expect(typeof logger.error).toBe("function");
		expect(typeof logger.debug).toBe("function");
	});
});
