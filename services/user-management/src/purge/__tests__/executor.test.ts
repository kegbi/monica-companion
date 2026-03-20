import { beforeEach, describe, expect, it, vi } from "vitest";
import { processPendingPurges } from "../executor.js";

function createMockServiceClient(success = true) {
	return {
		fetch: vi.fn().mockResolvedValue({
			ok: success,
			json: async () => ({ purged: {} }),
		}),
	};
}

function createMockDb(options?: {
	staleCount?: number;
	failedRetryCount?: number;
	pendingRequests?: Array<{
		id: string;
		userId: string;
		retryCount: number;
	}>;
}) {
	const { staleCount = 0, failedRetryCount = 0, pendingRequests = [] } = options ?? {};

	// Track calls for verification
	const updateCalls: Array<{ type: string }> = [];

	const mockExecute = vi.fn().mockImplementation(async () => {
		return [[]]; // Default empty result
	});

	// Simulate update().set().where() chain
	const mockWhere = vi.fn().mockResolvedValue({ rowCount: staleCount });
	const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
	const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

	// Simulate the RETURNING query for claiming pending requests
	const mockReturning = vi.fn().mockResolvedValue(
		pendingRequests.map((r) => ({
			...r,
			status: "in_progress",
			reason: "account_disconnection",
			requestedAt: new Date(),
			purgeAfter: new Date(Date.now() - 1000),
			claimedAt: new Date(),
			completedAt: null,
			error: null,
		})),
	);

	// Build the complete chain:
	// db.update(table).set({...}).where(...).returning()
	// We need to override behavior per call
	let callIndex = 0;
	const chainedUpdate = vi.fn().mockImplementation(() => {
		callIndex++;
		return {
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockImplementation(() => {
					// For the claiming query (3rd update call), return with .returning()
					if (callIndex === 3) {
						return {
							returning: mockReturning,
						};
					}
					return Promise.resolve({ rowCount: staleCount });
				}),
			}),
		};
	});

	return {
		update: chainedUpdate,
		execute: mockExecute,
		_mockReturning: mockReturning,
		_pendingRequests: pendingRequests,
	};
}

describe("processPendingPurges", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls all three service clients for each pending request", async () => {
		const aiRouterClient = createMockServiceClient();
		const schedulerClient = createMockServiceClient();
		const deliveryClient = createMockServiceClient();

		const pendingRequests = [{ id: "purge-1", userId: "user-1", retryCount: 0 }];
		const db = createMockDb({ pendingRequests });

		const config = {
			httpTimeoutMs: 10_000,
			staleClaimThresholdMinutes: 30,
			maxPurgeRetries: 5,
		};

		await processPendingPurges({
			config: config as never,
			db: db as never,
			aiRouterClient: aiRouterClient as never,
			schedulerClient: schedulerClient as never,
			deliveryClient: deliveryClient as never,
		});

		// All three clients should have been called
		expect(aiRouterClient.fetch).toHaveBeenCalledTimes(1);
		expect(schedulerClient.fetch).toHaveBeenCalledTimes(1);
		expect(deliveryClient.fetch).toHaveBeenCalledTimes(1);

		// Verify URL patterns
		expect(aiRouterClient.fetch.mock.calls[0][0]).toBe("/internal/users/user-1/data");
		expect(schedulerClient.fetch.mock.calls[0][0]).toBe("/internal/users/user-1/data");
		expect(deliveryClient.fetch.mock.calls[0][0]).toBe("/internal/users/user-1/data");
	});

	it("uses AbortSignal.timeout for all outbound calls", async () => {
		const aiRouterClient = createMockServiceClient();
		const schedulerClient = createMockServiceClient();
		const deliveryClient = createMockServiceClient();

		const pendingRequests = [{ id: "purge-1", userId: "user-1", retryCount: 0 }];
		const db = createMockDb({ pendingRequests });

		const config = {
			httpTimeoutMs: 5_000,
			staleClaimThresholdMinutes: 30,
			maxPurgeRetries: 5,
		};

		await processPendingPurges({
			config: config as never,
			db: db as never,
			aiRouterClient: aiRouterClient as never,
			schedulerClient: schedulerClient as never,
			deliveryClient: deliveryClient as never,
		});

		// All calls should include signal
		for (const client of [aiRouterClient, schedulerClient, deliveryClient]) {
			const opts = client.fetch.mock.calls[0][1];
			expect(opts.signal).toBeDefined();
		}
	});

	it("does nothing when no pending requests exist", async () => {
		const aiRouterClient = createMockServiceClient();
		const schedulerClient = createMockServiceClient();
		const deliveryClient = createMockServiceClient();

		const db = createMockDb({ pendingRequests: [] });

		const config = {
			httpTimeoutMs: 10_000,
			staleClaimThresholdMinutes: 30,
			maxPurgeRetries: 5,
		};

		await processPendingPurges({
			config: config as never,
			db: db as never,
			aiRouterClient: aiRouterClient as never,
			schedulerClient: schedulerClient as never,
			deliveryClient: deliveryClient as never,
		});

		expect(aiRouterClient.fetch).not.toHaveBeenCalled();
		expect(schedulerClient.fetch).not.toHaveBeenCalled();
		expect(deliveryClient.fetch).not.toHaveBeenCalled();
	});
});
