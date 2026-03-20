import { describe, expect, it, vi } from "vitest";
import { purgeExpiredDeliveryAudits } from "../cleanup.js";

function createMockDb(deleteResult: { count: number }) {
	const mockWhere = vi.fn().mockResolvedValue(deleteResult);
	const mockDelete = vi.fn().mockReturnValue({ where: mockWhere });
	return {
		delete: mockDelete,
		_where: mockWhere,
	};
}

describe("purgeExpiredDeliveryAudits", () => {
	it("returns the count of purged rows", async () => {
		const db = createMockDb({ count: 10 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredDeliveryAudits(db as never, cutoff);
		expect(count).toBe(10);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});

	it("returns 0 when no rows match", async () => {
		const db = createMockDb({ count: 0 });
		const cutoff = new Date("2024-01-01T00:00:00Z");
		const count = await purgeExpiredDeliveryAudits(db as never, cutoff);
		expect(count).toBe(0);
	});
});
