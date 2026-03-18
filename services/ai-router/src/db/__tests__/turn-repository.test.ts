/**
 * Unit tests for turn-repository.
 *
 * Uses a mock Drizzle DB to verify query construction and result mapping.
 * Integration tests with real PostgreSQL live in a separate file.
 */

import { describe, expect, it, vi } from "vitest";
import type { TurnSummary } from "../../graph/state.js";
import { getRecentTurns, insertTurnSummary } from "../turn-repository.js";

function createMockDb() {
	const mockLimit = vi.fn();
	const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
	const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
	const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
	const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

	const mockReturning = vi.fn();
	const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
	const mockInsertInto = vi.fn().mockReturnValue({ values: mockValues });

	return {
		db: {
			select: mockSelect,
			insert: mockInsertInto,
		} as any,
		mocks: {
			select: mockSelect,
			from: mockFrom,
			where: mockWhere,
			orderBy: mockOrderBy,
			limit: mockLimit,
			insert: mockInsertInto,
			values: mockValues,
			returning: mockReturning,
		},
	};
}

describe("getRecentTurns", () => {
	it("returns turn summaries in chronological order (oldest first)", async () => {
		const { db, mocks } = createMockDb();
		const dbRows = [
			{
				id: "id-2",
				userId: "user-1",
				role: "assistant",
				summary: "Responded with greeting",
				correlationId: "corr-1",
				createdAt: new Date("2026-01-01T00:01:00Z"),
			},
			{
				id: "id-1",
				userId: "user-1",
				role: "user",
				summary: "Requested greeting",
				correlationId: "corr-1",
				createdAt: new Date("2026-01-01T00:00:00Z"),
			},
		];
		mocks.limit.mockResolvedValue(dbRows);

		const result = await getRecentTurns(db, "user-1", 10);

		expect(result).toHaveLength(2);
		// Should be reversed to chronological order
		expect(result[0].summary).toBe("Requested greeting");
		expect(result[1].summary).toBe("Responded with greeting");
	});

	it("returns empty array when no turns exist", async () => {
		const { db, mocks } = createMockDb();
		mocks.limit.mockResolvedValue([]);

		const result = await getRecentTurns(db, "user-1", 10);

		expect(result).toEqual([]);
	});

	it("maps DB rows to TurnSummary shape", async () => {
		const { db, mocks } = createMockDb();
		const createdAt = new Date("2026-01-01T00:00:00Z");
		mocks.limit.mockResolvedValue([
			{
				id: "id-1",
				userId: "user-1",
				role: "user",
				summary: "Requested create_note for Jane",
				correlationId: "corr-1",
				createdAt,
			},
		]);

		const result = await getRecentTurns(db, "user-1", 5);

		expect(result).toHaveLength(1);
		const turn: TurnSummary = result[0];
		expect(turn.role).toBe("user");
		expect(turn.summary).toBe("Requested create_note for Jane");
		expect(turn.correlationId).toBe("corr-1");
		expect(turn.createdAt).toBe(createdAt.toISOString());
	});
});

describe("insertTurnSummary", () => {
	it("inserts a turn summary row and returns it", async () => {
		const { db, mocks } = createMockDb();
		const insertedRow = {
			id: "new-id",
			userId: "user-1",
			role: "user",
			summary: "Requested create_note for Jane",
			correlationId: "corr-1",
			createdAt: new Date("2026-01-01T00:00:00Z"),
		};
		mocks.returning.mockResolvedValue([insertedRow]);

		const result = await insertTurnSummary(db, {
			userId: "user-1",
			role: "user",
			summary: "Requested create_note for Jane",
			correlationId: "corr-1",
		});

		expect(result).toEqual(insertedRow);
	});

	it("passes correct values to insert", async () => {
		const { db, mocks } = createMockDb();
		mocks.returning.mockResolvedValue([
			{
				id: "new-id",
				userId: "user-1",
				role: "assistant",
				summary: "Responded with text",
				correlationId: "corr-2",
				createdAt: new Date(),
			},
		]);

		await insertTurnSummary(db, {
			userId: "user-1",
			role: "assistant",
			summary: "Responded with text",
			correlationId: "corr-2",
		});

		expect(mocks.values).toHaveBeenCalledWith({
			userId: "user-1",
			role: "assistant",
			summary: "Responded with text",
			correlationId: "corr-2",
		});
	});
});
