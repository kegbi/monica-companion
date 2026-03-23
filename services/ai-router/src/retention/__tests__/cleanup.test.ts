import { describe, expect, it, vi } from "vitest";
import {
	purgeExpiredConversationHistory,
	purgeExpiredConversationTurns,
	purgeExpiredPendingCommands,
} from "../cleanup.js";

function createMockDb(deleteResult: { count: number }) {
	const mockWhere = vi.fn().mockResolvedValue(deleteResult);
	const mockDelete = vi.fn().mockReturnValue({ where: mockWhere });
	return {
		delete: mockDelete,
		_where: mockWhere,
	};
}

describe("purgeExpiredConversationTurns", () => {
	it("returns the count of purged rows", async () => {
		const db = createMockDb({ count: 5 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredConversationTurns(db as never, cutoff);
		expect(count).toBe(5);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});

	it("returns 0 when no rows match", async () => {
		const db = createMockDb({ count: 0 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredConversationTurns(db as never, cutoff);
		expect(count).toBe(0);
	});
});

describe("purgeExpiredPendingCommands", () => {
	it("returns the count of purged terminal rows", async () => {
		const db = createMockDb({ count: 3 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredPendingCommands(db as never, cutoff);
		expect(count).toBe(3);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});

	it("returns 0 when no rows match", async () => {
		const db = createMockDb({ count: 0 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredPendingCommands(db as never, cutoff);
		expect(count).toBe(0);
	});
});

describe("purgeExpiredConversationHistory", () => {
	it("returns the count of purged rows", async () => {
		const db = createMockDb({ count: 2 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredConversationHistory(db as never, cutoff);
		expect(count).toBe(2);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});

	it("returns 0 when no rows match", async () => {
		const db = createMockDb({ count: 0 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredConversationHistory(db as never, cutoff);
		expect(count).toBe(0);
	});
});
