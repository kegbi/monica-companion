import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../history-repository.js", () => ({
	clearStaleHistories: vi.fn().mockResolvedValue(0),
}));

import { startHistoryInactivitySweep } from "../history-inactivity-sweep.js";
import { clearStaleHistories } from "../history-repository.js";

const mockClearStale = vi.mocked(clearStaleHistories);

describe("startHistoryInactivitySweep", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockClearStale.mockReset();
		mockClearStale.mockResolvedValue(0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns a stop function", () => {
		const stop = startHistoryInactivitySweep({} as never, 60000);
		expect(typeof stop).toBe("function");
		stop();
	});

	it("calls clearStaleHistories on interval", async () => {
		const db = {} as never;
		const stop = startHistoryInactivitySweep(db, 1000);

		await vi.advanceTimersByTimeAsync(1000);
		expect(mockClearStale).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1000);
		expect(mockClearStale).toHaveBeenCalledTimes(2);

		stop();
	});

	it("passes a cutoff date 24 hours in the past", async () => {
		const db = {} as never;
		const now = new Date("2024-06-15T12:00:00Z");
		vi.setSystemTime(now);

		const stop = startHistoryInactivitySweep(db, 1000);
		await vi.advanceTimersByTimeAsync(1000);

		expect(mockClearStale).toHaveBeenCalledTimes(1);
		const cutoff = mockClearStale.mock.calls[0][1] as Date;
		// Cutoff should be approximately 24 hours before "now + 1000ms"
		const expectedCutoff = new Date(now.getTime() + 1000 - 24 * 60 * 60 * 1000);
		expect(cutoff.getTime()).toBeCloseTo(expectedCutoff.getTime(), -3);

		stop();
	});

	it("logs count when stale histories are cleared", async () => {
		mockClearStale.mockResolvedValueOnce(5);
		const db = {} as never;
		const stop = startHistoryInactivitySweep(db, 1000);

		await vi.advanceTimersByTimeAsync(1000);
		expect(mockClearStale).toHaveBeenCalledTimes(1);

		stop();
	});

	it("does not throw when clearStaleHistories rejects", async () => {
		mockClearStale.mockRejectedValueOnce(new Error("DB error"));
		const db = {} as never;
		const stop = startHistoryInactivitySweep(db, 1000);

		// Should not throw
		await vi.advanceTimersByTimeAsync(1000);
		expect(mockClearStale).toHaveBeenCalledTimes(1);

		stop();
	});

	it("stops the sweep when stop function is called", async () => {
		const db = {} as never;
		const stop = startHistoryInactivitySweep(db, 1000);

		await vi.advanceTimersByTimeAsync(1000);
		expect(mockClearStale).toHaveBeenCalledTimes(1);

		stop();

		await vi.advanceTimersByTimeAsync(2000);
		// Should still be 1 since we stopped
		expect(mockClearStale).toHaveBeenCalledTimes(1);
	});
});
