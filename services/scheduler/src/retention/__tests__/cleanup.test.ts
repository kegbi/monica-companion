import { describe, expect, it, vi } from "vitest";
import {
	purgeExpiredExecutions,
	purgeExpiredIdempotencyKeys,
	purgeExpiredReminderWindows,
} from "../cleanup.js";

function createMockDb(deleteResult: { count: number }) {
	const mockWhere = vi.fn().mockResolvedValue(deleteResult);
	const mockDelete = vi.fn().mockReturnValue({ where: mockWhere });
	return {
		delete: mockDelete,
		_where: mockWhere,
	};
}

describe("purgeExpiredExecutions", () => {
	it("returns the count of purged rows", async () => {
		const db = createMockDb({ count: 7 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredExecutions(db as never, cutoff);
		expect(count).toBe(7);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});

	it("returns 0 when no rows match", async () => {
		const db = createMockDb({ count: 0 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredExecutions(db as never, cutoff);
		expect(count).toBe(0);
	});
});

describe("purgeExpiredIdempotencyKeys", () => {
	it("returns the count of purged rows", async () => {
		const db = createMockDb({ count: 12 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredIdempotencyKeys(db as never, cutoff);
		expect(count).toBe(12);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});

	it("returns 0 when no rows match", async () => {
		const db = createMockDb({ count: 0 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredIdempotencyKeys(db as never, cutoff);
		expect(count).toBe(0);
	});
});

describe("purgeExpiredReminderWindows", () => {
	it("returns the count of purged rows", async () => {
		const db = createMockDb({ count: 4 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredReminderWindows(db as never, cutoff);
		expect(count).toBe(4);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});

	it("returns 0 when no rows match", async () => {
		const db = createMockDb({ count: 0 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredReminderWindows(db as never, cutoff);
		expect(count).toBe(0);
	});
});
