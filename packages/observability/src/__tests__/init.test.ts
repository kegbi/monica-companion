import { describe, expect, it } from "vitest";
import { initTelemetry } from "../init";

describe("initTelemetry", () => {
	it("returns a shutdown function and does not throw", () => {
		const result = initTelemetry({
			serviceName: "test-service",
			enabled: false,
		});

		expect(result).toBeDefined();
		expect(typeof result.shutdown).toBe("function");
	});

	it("accepts config with otlpEndpoint", () => {
		const result = initTelemetry({
			serviceName: "test-service",
			otlpEndpoint: "http://localhost:4318",
			enabled: false,
		});

		expect(result).toBeDefined();
		expect(typeof result.shutdown).toBe("function");
	});

	it("handles missing otlpEndpoint gracefully", () => {
		const result = initTelemetry({
			serviceName: "test-service",
			enabled: false,
		});

		expect(result).toBeDefined();
	});

	it("shutdown function returns a promise", async () => {
		const result = initTelemetry({
			serviceName: "test-service",
			enabled: false,
		});

		const shutdownResult = result.shutdown();
		expect(shutdownResult).toBeInstanceOf(Promise);
		await shutdownResult;
	});

	it("starts and shuts down with enabled=true and no endpoint", async () => {
		const result = initTelemetry({
			serviceName: "test-service-enabled",
			enabled: true,
		});

		expect(result).toBeDefined();
		expect(typeof result.shutdown).toBe("function");
		await result.shutdown();
	});
});
