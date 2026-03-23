import { describe, expect, it, vi } from "vitest";
import {
	clearHistory,
	clearStaleHistories,
	getHistory,
	SLIDING_WINDOW_SIZE,
	saveHistory,
} from "../history-repository.js";

function createMockDb() {
	const mockResultRows: unknown[] = [];
	const mockDeleteResult = { count: 0 };

	const mockLimit = vi.fn().mockResolvedValue(mockResultRows);
	const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockLimit });
	const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
	const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

	const mockOnConflict = vi.fn().mockResolvedValue([]);
	const mockInsertValues = vi.fn().mockReturnValue({
		onConflictDoUpdate: mockOnConflict,
	});
	const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

	const mockDeleteWhere = vi.fn().mockResolvedValue(mockDeleteResult);
	const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

	return {
		select: mockSelect,
		insert: mockInsert,
		delete: mockDelete,
		_mockResultRows: mockResultRows,
		_mockDeleteResult: mockDeleteResult,
		_mockLimit: mockLimit,
		_mockInsertValues: mockInsertValues,
		_mockOnConflict: mockOnConflict,
		_mockDeleteWhere: mockDeleteWhere,
	};
}

describe("history-repository", () => {
	describe("getHistory", () => {
		it("returns null when no history exists for user", async () => {
			const db = createMockDb();
			db._mockLimit.mockResolvedValueOnce([]);

			const result = await getHistory(db as never, "user-uuid-1");
			expect(result).toBeNull();
			expect(db.select).toHaveBeenCalledTimes(1);
		});

		it("returns the history row when it exists", async () => {
			const db = createMockDb();
			const row = {
				id: "hist-1",
				userId: "user-uuid-1",
				messages: [{ role: "user", content: "Hello" }],
				pendingToolCall: null,
				updatedAt: new Date(),
			};
			db._mockLimit.mockResolvedValueOnce([row]);

			const result = await getHistory(db as never, "user-uuid-1");
			expect(result).toEqual(row);
		});
	});

	describe("saveHistory", () => {
		it("upserts messages and pendingToolCall", async () => {
			const db = createMockDb();
			const messages = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi!" },
			];

			await saveHistory(db as never, "user-uuid-1", messages, null);
			expect(db.insert).toHaveBeenCalledTimes(1);
			expect(db._mockOnConflict).toHaveBeenCalledTimes(1);
		});

		it("truncates messages to sliding window size", async () => {
			const db = createMockDb();
			const messages = Array.from({ length: 50 }, (_, i) => ({
				role: "user",
				content: `Message ${i}`,
			}));

			await saveHistory(db as never, "user-uuid-1", messages, null);
			expect(db.insert).toHaveBeenCalledTimes(1);

			// Verify the inserted values contain truncated messages
			const insertCall = db.insert.mock.calls[0];
			expect(insertCall).toBeDefined();
		});

		it("insert 50 messages, verify values call receives only the last 40", async () => {
			const db = createMockDb();
			const messages = Array.from({ length: 50 }, (_, i) => ({
				role: "user",
				content: `Message ${i}`,
			}));

			await saveHistory(db as never, "user-uuid-1", messages, null);

			// Capture the values passed to insert().values()
			const valuesArg = db._mockInsertValues.mock.calls[0][0];
			const savedMessages = valuesArg.messages as Array<{ role: string; content: string }>;

			expect(savedMessages).toHaveLength(SLIDING_WINDOW_SIZE);
			// Should contain messages 10-49 (the last 40)
			expect(savedMessages[0].content).toBe("Message 10");
			expect(savedMessages[39].content).toBe("Message 49");
		});

		it("insert exactly 40 messages, verify all 40 preserved", async () => {
			const db = createMockDb();
			const messages = Array.from({ length: 40 }, (_, i) => ({
				role: "user",
				content: `Message ${i}`,
			}));

			await saveHistory(db as never, "user-uuid-1", messages, null);

			const valuesArg = db._mockInsertValues.mock.calls[0][0];
			const savedMessages = valuesArg.messages as Array<{ role: string; content: string }>;

			expect(savedMessages).toHaveLength(40);
			expect(savedMessages[0].content).toBe("Message 0");
			expect(savedMessages[39].content).toBe("Message 39");
		});

		it("insert 1 message, verify it survives", async () => {
			const db = createMockDb();
			const messages = [{ role: "user", content: "Single message" }];

			await saveHistory(db as never, "user-uuid-1", messages, null);

			const valuesArg = db._mockInsertValues.mock.calls[0][0];
			const savedMessages = valuesArg.messages as Array<{ role: string; content: string }>;

			expect(savedMessages).toHaveLength(1);
			expect(savedMessages[0].content).toBe("Single message");
		});
	});

	describe("clearHistory", () => {
		it("deletes history for the given user", async () => {
			const db = createMockDb();
			db._mockDeleteWhere.mockResolvedValueOnce({ count: 1 });

			const count = await clearHistory(db as never, "user-uuid-1");
			expect(count).toBe(1);
			expect(db.delete).toHaveBeenCalledTimes(1);
		});

		it("returns 0 when no history exists", async () => {
			const db = createMockDb();
			db._mockDeleteWhere.mockResolvedValueOnce({ count: 0 });

			const count = await clearHistory(db as never, "user-uuid-1");
			expect(count).toBe(0);
		});
	});

	describe("clearStaleHistories", () => {
		it("deletes histories older than the cutoff", async () => {
			const db = createMockDb();
			db._mockDeleteWhere.mockResolvedValueOnce({ count: 3 });

			const cutoff = new Date("2024-01-01T00:00:00Z");
			const count = await clearStaleHistories(db as never, cutoff);
			expect(count).toBe(3);
			expect(db.delete).toHaveBeenCalledTimes(1);
		});
	});

	describe("SLIDING_WINDOW_SIZE", () => {
		it("is 40", () => {
			expect(SLIDING_WINDOW_SIZE).toBe(40);
		});
	});
});
