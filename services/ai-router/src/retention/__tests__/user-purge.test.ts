import { describe, expect, it, vi } from "vitest";
import {
	purgeUserConversationHistory,
	purgeUserConversationTurns,
	purgeUserPendingCommands,
} from "../user-purge.js";

function createMockDb(deleteResult: { count: number }) {
	const mockWhere = vi.fn().mockResolvedValue(deleteResult);
	const mockDelete = vi.fn().mockReturnValue({ where: mockWhere });
	return {
		delete: mockDelete,
		_where: mockWhere,
	};
}

describe("purgeUserConversationTurns", () => {
	it("returns the count of purged rows for a user", async () => {
		const db = createMockDb({ count: 15 });
		const count = await purgeUserConversationTurns(db as never, "user-uuid-1");
		expect(count).toBe(15);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});
});

describe("purgeUserPendingCommands", () => {
	it("returns the count of purged rows for a user", async () => {
		const db = createMockDb({ count: 4 });
		const count = await purgeUserPendingCommands(db as never, "user-uuid-1");
		expect(count).toBe(4);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});
});

describe("purgeUserConversationHistory", () => {
	it("returns the count of purged rows for a user", async () => {
		const db = createMockDb({ count: 1 });
		const count = await purgeUserConversationHistory(db as never, "user-uuid-1");
		expect(count).toBe(1);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});
});
