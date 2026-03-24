import { describe, expect, it, vi } from "vitest";
import { purgeUserConversationHistory } from "../user-purge.js";

function createMockDb(deleteResult: { count: number }) {
	const mockWhere = vi.fn().mockResolvedValue(deleteResult);
	const mockDelete = vi.fn().mockReturnValue({ where: mockWhere });
	return {
		delete: mockDelete,
		_where: mockWhere,
	};
}

describe("purgeUserConversationHistory", () => {
	it("returns the count of purged rows for a user", async () => {
		const db = createMockDb({ count: 1 });
		const count = await purgeUserConversationHistory(db as never, "user-uuid-1");
		expect(count).toBe(1);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});
});
