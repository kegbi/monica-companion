import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdempotencyStore } from "../store";

/**
 * Unit tests for IdempotencyStore with mocked database.
 * Tests cover: check, claim, complete, release operations,
 * and expired key reclaim behavior.
 */

function createMockDb() {
	return {
		execute: vi.fn(),
	};
}

describe("IdempotencyStore", () => {
	let db: ReturnType<typeof createMockDb>;
	let store: IdempotencyStore;

	beforeEach(() => {
		db = createMockDb();
		store = new IdempotencyStore(db as never);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("check", () => {
		it("returns null for unknown key", async () => {
			db.execute.mockResolvedValue([]);
			const result = await store.check("unknown-key");
			expect(result).toBeNull();
		});

		it("returns in_progress for claimed key", async () => {
			db.execute.mockResolvedValue([{ status: "in_progress", result: null }]);
			const result = await store.check("claimed-key");
			expect(result).toEqual({ status: "in_progress" });
		});

		it("returns completed with result for completed key", async () => {
			const storedResult = { contactId: 42 };
			db.execute.mockResolvedValue([{ status: "completed", result: storedResult }]);
			const result = await store.check("done-key");
			expect(result).toEqual({ status: "completed", result: storedResult });
		});
	});

	describe("claim", () => {
		it("returns claimed: true when key is new", async () => {
			// First call: reclaim expired returns nothing
			db.execute.mockResolvedValueOnce([]);
			// Second call: INSERT succeeds (returns a row via RETURNING)
			db.execute.mockResolvedValueOnce([{ key: "new-key" }]);
			const result = await store.claim("new-key", 60_000);
			expect(result).toEqual({ claimed: true });
		});

		it("returns claimed: false when key already exists", async () => {
			// First call: reclaim expired returns nothing
			db.execute.mockResolvedValueOnce([]);
			// Second call: INSERT returns nothing (ON CONFLICT DO NOTHING)
			db.execute.mockResolvedValueOnce([]);
			const result = await store.claim("existing-key", 60_000);
			expect(result).toEqual({ claimed: false });
		});
	});

	describe("complete", () => {
		it("marks key as completed with result", async () => {
			const result = { contactId: 42 };
			db.execute.mockResolvedValue([{ key: "done-key" }]);
			await store.complete("done-key", result);
			expect(db.execute).toHaveBeenCalled();
		});
	});

	describe("release", () => {
		it("removes an in_progress claim", async () => {
			db.execute.mockResolvedValue([]);
			await store.release("release-key");
			expect(db.execute).toHaveBeenCalled();
		});
	});
});
