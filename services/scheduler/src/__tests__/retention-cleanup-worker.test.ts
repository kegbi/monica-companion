import { beforeEach, describe, expect, it, vi } from "vitest";
import { processRetentionCleanup } from "../workers/retention-cleanup-worker.js";

const mockPurgeExpiredExecutions = vi.fn().mockResolvedValue(10);
const mockPurgeExpiredIdempotencyKeys = vi.fn().mockResolvedValue(5);
const mockPurgeExpiredReminderWindows = vi.fn().mockResolvedValue(3);

const mockAiRouterClient = {
	fetch: vi.fn().mockResolvedValue({
		ok: true,
		json: async () => ({ purged: { conversationTurns: 7, pendingCommands: 2 } }),
	}),
};

const mockDeliveryClient = {
	fetch: vi.fn().mockResolvedValue({
		ok: true,
		json: async () => ({ purged: { deliveryAudits: 4 } }),
	}),
};

describe("processRetentionCleanup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
	});

	it("calls local cleanup functions with correct cutoff dates", async () => {
		const config = {
			conversationRetentionDays: 30,
			commandLogRetentionDays: 90,
			idempotencyKeyRetentionDays: 14,
			reminderWindowRetentionDays: 14,
			httpTimeoutMs: 10_000,
		};

		await processRetentionCleanup({
			config: config as never,
			db: {} as never,
			aiRouterClient: mockAiRouterClient as never,
			deliveryClient: mockDeliveryClient as never,
			purgeExpiredExecutions: mockPurgeExpiredExecutions,
			purgeExpiredIdempotencyKeys: mockPurgeExpiredIdempotencyKeys,
			purgeExpiredReminderWindows: mockPurgeExpiredReminderWindows,
		});

		// Verify local cleanup functions were called with correct cutoff dates
		const executionCutoff = mockPurgeExpiredExecutions.mock.calls[0][1] as Date;
		const idempotencyCutoff = mockPurgeExpiredIdempotencyKeys.mock.calls[0][1] as Date;
		const reminderCutoff = mockPurgeExpiredReminderWindows.mock.calls[0][1] as Date;

		// 90-day cutoff for executions
		expect(executionCutoff.toISOString()).toBe(new Date("2024-03-17T12:00:00Z").toISOString());
		// 14-day cutoff for idempotency keys
		expect(idempotencyCutoff.toISOString()).toBe(new Date("2024-06-01T12:00:00Z").toISOString());
		// 14-day cutoff for reminder windows
		expect(reminderCutoff.toISOString()).toBe(new Date("2024-06-01T12:00:00Z").toISOString());
	});

	it("calls ai-router cleanup endpoint with correct payload", async () => {
		const config = {
			conversationRetentionDays: 30,
			commandLogRetentionDays: 90,
			idempotencyKeyRetentionDays: 14,
			reminderWindowRetentionDays: 14,
			httpTimeoutMs: 10_000,
		};

		await processRetentionCleanup({
			config: config as never,
			db: {} as never,
			aiRouterClient: mockAiRouterClient as never,
			deliveryClient: mockDeliveryClient as never,
			purgeExpiredExecutions: mockPurgeExpiredExecutions,
			purgeExpiredIdempotencyKeys: mockPurgeExpiredIdempotencyKeys,
			purgeExpiredReminderWindows: mockPurgeExpiredReminderWindows,
		});

		expect(mockAiRouterClient.fetch).toHaveBeenCalledTimes(1);
		const [url, opts] = mockAiRouterClient.fetch.mock.calls[0];
		expect(url).toBe("/internal/retention-cleanup");
		expect(opts.method).toBe("POST");

		const body = JSON.parse(opts.body);
		expect(body.conversationTurnsCutoff).toBe(new Date("2024-05-16T12:00:00Z").toISOString());
		expect(body.pendingCommandsCutoff).toBe(new Date("2024-05-16T12:00:00Z").toISOString());
	});

	it("calls delivery cleanup endpoint with correct payload", async () => {
		const config = {
			conversationRetentionDays: 30,
			commandLogRetentionDays: 90,
			idempotencyKeyRetentionDays: 14,
			reminderWindowRetentionDays: 14,
			httpTimeoutMs: 10_000,
		};

		await processRetentionCleanup({
			config: config as never,
			db: {} as never,
			aiRouterClient: mockAiRouterClient as never,
			deliveryClient: mockDeliveryClient as never,
			purgeExpiredExecutions: mockPurgeExpiredExecutions,
			purgeExpiredIdempotencyKeys: mockPurgeExpiredIdempotencyKeys,
			purgeExpiredReminderWindows: mockPurgeExpiredReminderWindows,
		});

		expect(mockDeliveryClient.fetch).toHaveBeenCalledTimes(1);
		const [url, opts] = mockDeliveryClient.fetch.mock.calls[0];
		expect(url).toBe("/internal/retention-cleanup");
		expect(opts.method).toBe("POST");

		const body = JSON.parse(opts.body);
		expect(body.deliveryAuditsCutoff).toBe(new Date("2024-03-17T12:00:00Z").toISOString());
	});

	it("uses AbortSignal.timeout for outbound calls", async () => {
		const config = {
			conversationRetentionDays: 30,
			commandLogRetentionDays: 90,
			idempotencyKeyRetentionDays: 14,
			reminderWindowRetentionDays: 14,
			httpTimeoutMs: 10_000,
		};

		await processRetentionCleanup({
			config: config as never,
			db: {} as never,
			aiRouterClient: mockAiRouterClient as never,
			deliveryClient: mockDeliveryClient as never,
			purgeExpiredExecutions: mockPurgeExpiredExecutions,
			purgeExpiredIdempotencyKeys: mockPurgeExpiredIdempotencyKeys,
			purgeExpiredReminderWindows: mockPurgeExpiredReminderWindows,
		});

		// Both calls should include signal
		const aiRouterOpts = mockAiRouterClient.fetch.mock.calls[0][1];
		expect(aiRouterOpts.signal).toBeDefined();
		const deliveryOpts = mockDeliveryClient.fetch.mock.calls[0][1];
		expect(deliveryOpts.signal).toBeDefined();
	});
});
