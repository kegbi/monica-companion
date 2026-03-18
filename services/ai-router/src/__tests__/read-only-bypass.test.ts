import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { buildConfirmedPayload } from "../pending-command/confirm.js";

/**
 * Read-only bypass verification tests.
 *
 * These tests verify the architectural property that read-only queries
 * bypass the scheduler and flow directly to delivery. Specifically:
 *
 * 1. ai-router config has DELIVERY_URL (for direct delivery) but no SCHEDULER_URL
 *    (confirming read-only responses go to delivery, not scheduler).
 * 2. buildConfirmedPayload() output matches the shape that scheduler's
 *    CommandJobData expects, ensuring the confirmed-command contract is sound.
 */

const baseEnv = {
	SERVICE_NAME: "ai-router" as const,
	JWT_SECRET: "test-jwt-secret-minimum-length-32chars!",
	DATABASE_URL: "postgresql://monica:monica_dev@localhost:5432/monica_companion",
	MONICA_INTEGRATION_URL: "http://monica-integration:3004",
	DELIVERY_URL: "http://delivery:3006",
	REDIS_URL: "redis://localhost:6379",
	OPENAI_API_KEY: "sk-test-key-for-bypass",
};

describe("read-only bypass verification", () => {
	describe("ai-router config", () => {
		it("has DELIVERY_URL for direct delivery of read-only responses", () => {
			const config = loadConfig(baseEnv);
			expect(config.deliveryUrl).toBe("http://delivery:3006");
		});

		it("does not have a SCHEDULER_URL in the config schema", () => {
			const config = loadConfig(baseEnv);
			// ai-router never routes to scheduler directly; confirmed commands
			// are posted to the scheduler's HTTP endpoint, but there is no
			// SCHEDULER_URL config value. The config object should not have
			// any scheduler-related URL.
			expect(config).not.toHaveProperty("schedulerUrl");
		});

		it("accepts config without DELIVERY_URL (optional for backward compat)", () => {
			const { DELIVERY_URL, ...envWithoutDelivery } = baseEnv;
			const config = loadConfig(envWithoutDelivery);
			expect(config.deliveryUrl).toBeUndefined();
		});
	});

	describe("buildConfirmedPayload contract alignment", () => {
		const mockPendingCommandRow = {
			id: "550e8400-e29b-41d4-a716-446655440000",
			userId: "660e8400-e29b-41d4-a716-446655440001",
			commandType: "create_contact",
			payload: {
				type: "create_contact" as const,
				firstName: "Jane",
				genderId: 1,
			},
			status: "confirmed" as const,
			version: 1,
			sourceMessageRef: "telegram:msg:12345",
			correlationId: "corr-123",
			createdAt: new Date(),
			updatedAt: new Date(),
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: new Date(),
			executedAt: null,
			terminalAt: null,
			executionResult: null,
		};

		it("produces output with all fields scheduler CommandJobData expects", () => {
			const confirmed = buildConfirmedPayload(mockPendingCommandRow);

			// Scheduler's CommandJobData wraps ConfirmedCommandPayload as `command`
			// and adds executionId + correlationId. The confirmed payload must have:
			expect(confirmed).toHaveProperty("pendingCommandId");
			expect(confirmed).toHaveProperty("userId");
			expect(confirmed).toHaveProperty("commandType");
			expect(confirmed).toHaveProperty("payload");
			expect(confirmed).toHaveProperty("idempotencyKey");
			expect(confirmed).toHaveProperty("correlationId");
			expect(confirmed).toHaveProperty("confirmedAt");
		});

		it("generates deterministic idempotency key from id and version", () => {
			const confirmed = buildConfirmedPayload(mockPendingCommandRow);
			expect(confirmed.idempotencyKey).toBe(
				`${mockPendingCommandRow.id}:v${mockPendingCommandRow.version}`,
			);
		});

		it("preserves userId and correlationId from the pending command", () => {
			const confirmed = buildConfirmedPayload(mockPendingCommandRow);
			expect(confirmed.userId).toBe(mockPendingCommandRow.userId);
			expect(confirmed.correlationId).toBe(mockPendingCommandRow.correlationId);
		});

		it("preserves the full payload for scheduler execution", () => {
			const confirmed = buildConfirmedPayload(mockPendingCommandRow);
			expect(confirmed.payload).toEqual(mockPendingCommandRow.payload);
		});
	});
});
