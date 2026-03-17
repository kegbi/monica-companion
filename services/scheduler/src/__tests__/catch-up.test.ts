import { afterEach, describe, expect, it, vi } from "vitest";
import { isWithinCatchUpWindow } from "../lib/schedule-time";

describe("catch-up logic", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("sends catch-up when scheduler was down for 3 hours", () => {
		const scheduled = new Date("2026-03-17T08:00:00Z");
		const now = new Date("2026-03-17T11:00:00Z"); // 3h later
		expect(isWithinCatchUpWindow(scheduled, now, 6)).toBe(true);
	});

	it("skips when scheduler was down for 7 hours", () => {
		const scheduled = new Date("2026-03-17T08:00:00Z");
		const now = new Date("2026-03-17T15:00:00Z"); // 7h later
		expect(isWithinCatchUpWindow(scheduled, now, 6)).toBe(false);
	});

	it("sends at exactly 6 hours boundary", () => {
		const scheduled = new Date("2026-03-17T08:00:00Z");
		const now = new Date("2026-03-17T14:00:00Z"); // exactly 6h
		expect(isWithinCatchUpWindow(scheduled, now, 6)).toBe(true);
	});

	it("each missed window evaluated independently", () => {
		const window1 = new Date("2026-03-17T08:00:00Z");
		const window2 = new Date("2026-03-16T08:00:00Z");
		const now = new Date("2026-03-17T11:00:00Z");

		// Window 1 is 3h ago -> within catch-up
		expect(isWithinCatchUpWindow(window1, now, 6)).toBe(true);
		// Window 2 is 27h ago -> outside catch-up
		expect(isWithinCatchUpWindow(window2, now, 6)).toBe(false);
	});

	it("rejects future scheduled time", () => {
		const scheduled = new Date("2026-03-17T14:00:00Z");
		const now = new Date("2026-03-17T11:00:00Z");
		expect(isWithinCatchUpWindow(scheduled, now, 6)).toBe(false);
	});

	it("handles 5h59m as within window", () => {
		const scheduled = new Date("2026-03-17T08:00:00Z");
		const now = new Date("2026-03-17T13:59:00Z"); // 5h 59m
		expect(isWithinCatchUpWindow(scheduled, now, 6)).toBe(true);
	});
});
