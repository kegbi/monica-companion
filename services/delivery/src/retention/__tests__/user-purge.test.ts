import { describe, expect, it, vi } from "vitest";
import { purgeUserDeliveryAudits } from "../user-purge.js";

function createMockDb(deleteResult: { count: number }) {
	const mockWhere = vi.fn().mockResolvedValue(deleteResult);
	const mockDelete = vi.fn().mockReturnValue({ where: mockWhere });
	return {
		delete: mockDelete,
		_where: mockWhere,
	};
}

describe("purgeUserDeliveryAudits", () => {
	it("returns the count of purged rows for a user", async () => {
		const db = createMockDb({ count: 12 });
		const count = await purgeUserDeliveryAudits(db as never, "user-uuid-1");
		expect(count).toBe(12);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});
});
