import { describe, expect, it } from "vitest";
import { createQueueMetrics } from "../lib/queue-metrics";

describe("createQueueMetrics", () => {
	it("returns an object with all expected metric recording methods", () => {
		const m = createQueueMetrics();

		expect(typeof m.recordJobWaitDuration).toBe("function");
		expect(typeof m.recordJobProcessDuration).toBe("function");
		expect(typeof m.updateQueueDepth).toBe("function");
		expect(typeof m.recordRetry).toBe("function");
		expect(typeof m.recordDeadLetter).toBe("function");
		expect(typeof m.recordReminderOnTime).toBe("function");
		expect(typeof m.recordReminderLate).toBe("function");
		expect(typeof m.recordReminderMissed).toBe("function");
	});

	it("recording methods do not throw when called with valid arguments", () => {
		const m = createQueueMetrics();

		expect(() => m.recordJobWaitDuration("command-execution", 1.5)).not.toThrow();
		expect(() => m.recordJobProcessDuration("command-execution", "completed", 0.8)).not.toThrow();
		expect(() => m.updateQueueDepth("command-execution", "waiting", 5)).not.toThrow();
		expect(() => m.recordRetry("command-execution")).not.toThrow();
		expect(() => m.recordDeadLetter("command-execution")).not.toThrow();
		expect(() => m.recordReminderOnTime()).not.toThrow();
		expect(() => m.recordReminderLate()).not.toThrow();
		expect(() => m.recordReminderMissed()).not.toThrow();
	});

	it("accepts all queue states for updateQueueDepth", () => {
		const m = createQueueMetrics();

		expect(() => m.updateQueueDepth("reminder-execute", "waiting", 10)).not.toThrow();
		expect(() => m.updateQueueDepth("reminder-execute", "active", 2)).not.toThrow();
		expect(() => m.updateQueueDepth("reminder-execute", "delayed", 3)).not.toThrow();
	});
});
