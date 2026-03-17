import { describe, expect, it } from "vitest";
import {
	computeDedupeKey,
	computeNextFiringUtc,
	isWithinCatchUpWindow,
} from "../lib/schedule-time";

describe("computeNextFiringUtc", () => {
	it("computes next daily firing for America/New_York at 08:00", () => {
		// 2026-03-17 00:00 UTC = 2026-03-16 20:00 ET (EDT, UTC-4)
		// Next 08:00 ET = 2026-03-17 12:00 UTC
		const now = new Date("2026-03-17T00:00:00Z");
		const result = computeNextFiringUtc("America/New_York", "08:00", "daily", now);
		expect(result.toISOString()).toBe("2026-03-17T12:00:00.000Z");
	});

	it("returns tomorrow when today's time already passed", () => {
		// 2026-03-17 20:00 UTC = 2026-03-17 16:00 ET
		// 08:00 ET already passed, next is 2026-03-18 12:00 UTC
		const now = new Date("2026-03-17T20:00:00Z");
		const result = computeNextFiringUtc("America/New_York", "08:00", "daily", now);
		expect(result.toISOString()).toBe("2026-03-18T12:00:00.000Z");
	});

	it("handles UTC timezone", () => {
		const now = new Date("2026-03-17T07:00:00Z");
		const result = computeNextFiringUtc("UTC", "08:00", "daily", now);
		expect(result.toISOString()).toBe("2026-03-17T08:00:00.000Z");
	});

	it("handles Asia/Tokyo (UTC+9, no DST)", () => {
		// 2026-03-17 00:00 UTC = 2026-03-17 09:00 JST
		// Next 08:00 JST = 2026-03-17 23:00 UTC (previous day from UTC perspective: 2026-03-17)
		// Wait: 08:00 JST on 2026-03-17 = 2026-03-16T23:00Z. That's in the past.
		// So next is 08:00 JST on 2026-03-18 = 2026-03-17T23:00Z
		const now = new Date("2026-03-17T00:00:00Z");
		const result = computeNextFiringUtc("Asia/Tokyo", "08:00", "daily", now);
		expect(result.toISOString()).toBe("2026-03-17T23:00:00.000Z");
	});

	it("handles spring forward: 02:30 in America/New_York on 2026-03-08 (DST starts)", () => {
		// On 2026-03-08, clocks spring forward from 02:00 -> 03:00 EST->EDT
		// 02:30 doesn't exist, should use 03:00 EDT (= 07:00 UTC)
		const now = new Date("2026-03-08T00:00:00Z"); // 2026-03-07 19:00 EST
		const result = computeNextFiringUtc("America/New_York", "02:30", "daily", now);
		// The function should resolve to 03:00 EDT = 07:00 UTC
		expect(result.toISOString()).toBe("2026-03-08T07:00:00.000Z");
	});

	it("handles fall back: 01:30 in America/New_York on 2026-11-01 (DST ends)", () => {
		// On 2026-11-01, clocks fall back from 02:00 -> 01:00 EDT->EST
		// 01:30 occurs twice; should use the first occurrence (EDT)
		// 01:30 EDT = 05:30 UTC
		const now = new Date("2026-11-01T00:00:00Z"); // 2026-10-31 20:00 EDT
		const result = computeNextFiringUtc("America/New_York", "01:30", "daily", now);
		expect(result.toISOString()).toBe("2026-11-01T05:30:00.000Z");
	});

	it("handles Europe/London (GMT/BST transition)", () => {
		// 2026-03-29 is BST transition day: clocks spring forward 01:00 -> 02:00
		const now = new Date("2026-03-28T23:00:00Z"); // 2026-03-28 23:00 GMT
		const result = computeNextFiringUtc("Europe/London", "08:00", "daily", now);
		// 08:00 BST = 07:00 UTC
		expect(result.toISOString()).toBe("2026-03-29T07:00:00.000Z");
	});

	it("handles weekly cadence", () => {
		const now = new Date("2026-03-17T00:00:00Z");
		const result = computeNextFiringUtc("UTC", "08:00", "weekly", now);
		expect(result.toISOString()).toBe("2026-03-17T08:00:00.000Z");
	});
});

describe("computeDedupeKey", () => {
	it("generates daily dedupe key with local date", () => {
		const key = computeDedupeKey("user-1", "daily", "2026-03-17");
		expect(key).toBe("reminder:user-1:daily:2026-03-17");
	});

	it("generates weekly dedupe key", () => {
		const key = computeDedupeKey("user-1", "weekly", "2026-W12");
		expect(key).toBe("reminder:user-1:weekly:2026-W12");
	});

	it("produces different keys for different users", () => {
		const key1 = computeDedupeKey("user-1", "daily", "2026-03-17");
		const key2 = computeDedupeKey("user-2", "daily", "2026-03-17");
		expect(key1).not.toBe(key2);
	});

	it("produces different keys for different dates", () => {
		const key1 = computeDedupeKey("user-1", "daily", "2026-03-17");
		const key2 = computeDedupeKey("user-1", "daily", "2026-03-18");
		expect(key1).not.toBe(key2);
	});
});

describe("isWithinCatchUpWindow", () => {
	it("returns true when within window", () => {
		const scheduled = new Date("2026-03-17T08:00:00Z");
		const now = new Date("2026-03-17T11:00:00Z"); // 3h later
		expect(isWithinCatchUpWindow(scheduled, now, 6)).toBe(true);
	});

	it("returns false when outside window", () => {
		const scheduled = new Date("2026-03-17T08:00:00Z");
		const now = new Date("2026-03-17T15:00:00Z"); // 7h later
		expect(isWithinCatchUpWindow(scheduled, now, 6)).toBe(false);
	});

	it("returns true at exact boundary (6h)", () => {
		const scheduled = new Date("2026-03-17T08:00:00Z");
		const now = new Date("2026-03-17T14:00:00Z"); // exactly 6h
		expect(isWithinCatchUpWindow(scheduled, now, 6)).toBe(true);
	});

	it("returns false at boundary + 1ms", () => {
		const scheduled = new Date("2026-03-17T08:00:00Z");
		const now = new Date("2026-03-17T14:00:00.001Z"); // 6h + 1ms
		expect(isWithinCatchUpWindow(scheduled, now, 6)).toBe(false);
	});

	it("returns false when now is before scheduled", () => {
		const scheduled = new Date("2026-03-17T08:00:00Z");
		const now = new Date("2026-03-17T07:00:00Z");
		expect(isWithinCatchUpWindow(scheduled, now, 6)).toBe(false);
	});
});
