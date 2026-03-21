/**
 * Unit tests for narrowing context repository functions.
 *
 * Uses a mock database to verify the update/clear logic
 * without requiring a running PostgreSQL instance.
 */

import { describe, expect, it, vi } from "vitest";

/**
 * We test against a mock DB. The actual SQL is integration-tested
 * in repository.integration.test.ts. These tests verify the function
 * contract: version check, status guard, return value semantics.
 */

// Import will be added after implementation
// import { updateNarrowingContext, clearNarrowingContext } from "../repository.js";

describe("updateNarrowingContext", () => {
	it("stores JSONB narrowing context and bumps version when version matches and status is draft", async () => {
		// Will import after implementation exists
		const { updateNarrowingContext } = await import("../repository.js");

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: [],
			round: 0,
			narrowingCandidateIds: [10, 20, 30, 40, 50, 60],
		};

		// Create a mock DB that returns the updated row
		const mockDb = {
			update: vi.fn().mockReturnThis(),
			set: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			returning: vi.fn().mockResolvedValue([
				{
					id: "cmd-1",
					userId: "user-1",
					commandType: "create_note",
					payload: { type: "create_note", body: "test" },
					status: "draft",
					version: 2,
					narrowingContext,
					sourceMessageRef: "tg:msg:1",
					correlationId: "corr-1",
					createdAt: new Date(),
					updatedAt: new Date(),
					expiresAt: new Date(Date.now() + 30 * 60 * 1000),
					confirmedAt: null,
					executedAt: null,
					terminalAt: null,
					executionResult: null,
				},
			]),
		} as any;

		const result = await updateNarrowingContext(mockDb, "cmd-1", 1, narrowingContext);

		expect(result).not.toBeNull();
		expect(result!.narrowingContext).toEqual(narrowingContext);
		expect(mockDb.update).toHaveBeenCalled();
	});

	it("returns null when version does not match (optimistic concurrency)", async () => {
		const { updateNarrowingContext } = await import("../repository.js");

		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: [],
			round: 0,
			narrowingCandidateIds: [10, 20],
		};

		// Mock DB returns empty array (no rows matched)
		const mockDb = {
			update: vi.fn().mockReturnThis(),
			set: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			returning: vi.fn().mockResolvedValue([]),
		} as any;

		const result = await updateNarrowingContext(mockDb, "cmd-1", 999, narrowingContext);

		expect(result).toBeNull();
	});
});

describe("clearNarrowingContext", () => {
	it("sets narrowing_context to null (idempotent)", async () => {
		const { clearNarrowingContext } = await import("../repository.js");

		const mockDb = {
			update: vi.fn().mockReturnThis(),
			set: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			returning: vi.fn().mockResolvedValue([
				{
					id: "cmd-1",
					narrowingContext: null,
				},
			]),
		} as any;

		const result = await clearNarrowingContext(mockDb, "cmd-1");

		expect(result).not.toBeNull();
		expect(mockDb.update).toHaveBeenCalled();
	});
});
