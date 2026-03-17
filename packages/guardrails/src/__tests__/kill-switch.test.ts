import { describe, expect, it, vi } from "vitest";
import { isKillSwitchActive, setKillSwitch } from "../kill-switch.js";
import type { GuardrailMetrics } from "../metrics.js";

function createMockMetrics(): GuardrailMetrics {
	return {
		recordRateLimitRejection: vi.fn(),
		recordConcurrencyRejection: vi.fn(),
		updateBudgetSpend: vi.fn(),
		updateBudgetLimit: vi.fn(),
		updateBudgetAlarm: vi.fn(),
		recordBudgetExhaustion: vi.fn(),
		updateKillSwitch: vi.fn(),
		recordKillSwitchRejection: vi.fn(),
		recordRequestAllowed: vi.fn(),
	};
}

describe("isKillSwitchActive", () => {
	it("returns false when key does not exist", async () => {
		const redis = { get: vi.fn().mockResolvedValue(null) };
		const metrics = createMockMetrics();
		const result = await isKillSwitchActive(redis as any, metrics);
		expect(result).toBe(false);
		expect(metrics.updateKillSwitch).toHaveBeenCalledWith(false);
	});

	it("returns true when key is set to 'on'", async () => {
		const redis = { get: vi.fn().mockResolvedValue("on") };
		const metrics = createMockMetrics();
		const result = await isKillSwitchActive(redis as any, metrics);
		expect(result).toBe(true);
		expect(metrics.updateKillSwitch).toHaveBeenCalledWith(true);
	});
});

describe("setKillSwitch", () => {
	it("sets the key to 'on' when active is true", async () => {
		const redis = { set: vi.fn().mockResolvedValue("OK"), del: vi.fn() };
		await setKillSwitch(redis as any, true);
		expect(redis.set).toHaveBeenCalledWith("guardrail:kill-switch", "on");
	});

	it("deletes the key when active is false", async () => {
		const redis = { set: vi.fn(), del: vi.fn().mockResolvedValue(1) };
		await setKillSwitch(redis as any, false);
		expect(redis.del).toHaveBeenCalledWith("guardrail:kill-switch");
	});
});
