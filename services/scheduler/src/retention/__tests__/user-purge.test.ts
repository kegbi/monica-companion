import { describe, expect, it, vi } from "vitest";
import { purgeUserCommandExecutionsAndKeys, purgeUserReminderWindows } from "../user-purge.js";

describe("purgeUserCommandExecutionsAndKeys", () => {
	it("returns counts of purged executions and keys using CTE", async () => {
		// Mock raw SQL execution for CTE query -- Drizzle returns { rows: [...] }
		const mockExecute = vi.fn().mockResolvedValue({
			rows: [{ executions_deleted: 5, keys_deleted: 3 }],
		});
		const db = {
			execute: mockExecute,
		};

		const result = await purgeUserCommandExecutionsAndKeys(db as never, "user-uuid-1");
		expect(result.commandExecutions).toBe(5);
		expect(result.idempotencyKeys).toBe(3);
	});

	it("returns zeros when no rows match (empty result set)", async () => {
		const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
		const db = { execute: mockExecute };

		const result = await purgeUserCommandExecutionsAndKeys(db as never, "user-uuid-nonexistent");
		expect(result.commandExecutions).toBe(0);
		expect(result.idempotencyKeys).toBe(0);
	});
});

describe("purgeUserReminderWindows", () => {
	it("returns the count of purged rows for a user", async () => {
		const mockWhere = vi.fn().mockResolvedValue({ count: 7 });
		const mockDelete = vi.fn().mockReturnValue({ where: mockWhere });
		const db = { delete: mockDelete };

		const count = await purgeUserReminderWindows(db as never, "user-uuid-1");
		expect(count).toBe(7);
		expect(db.delete).toHaveBeenCalledTimes(1);
	});
});
