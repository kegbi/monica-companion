import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CommandWorkerDeps, processCommandJob } from "../workers/command-worker";

function createMockDeps(): CommandWorkerDeps {
	return {
		monicaClient: {
			fetch: vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ contactId: 42 }), {
					status: 201,
					headers: { "Content-Type": "application/json" },
				}),
			),
		},
		deliveryClient: {
			fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
		},
		idempotencyStore: {
			check: vi.fn(),
			claim: vi.fn(),
			complete: vi.fn(),
			release: vi.fn(),
		},
		db: {
			execute: vi.fn(),
		},
	};
}

const testJobData = {
	executionId: "exec-1",
	command: {
		pendingCommandId: "550e8400-e29b-41d4-a716-446655440000",
		userId: "660e8400-e29b-41d4-a716-446655440001",
		commandType: "create_contact" as const,
		payload: {
			type: "create_contact" as const,
			firstName: "Jane",
			genderId: 1,
		},
		idempotencyKey: "550e8400-e29b-41d4-a716-446655440000:v1",
		correlationId: "corr-123",
		confirmedAt: new Date().toISOString(),
	},
	correlationId: "corr-123",
};

describe("processCommandJob", () => {
	let deps: CommandWorkerDeps;

	beforeEach(() => {
		deps = createMockDeps();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("calls monica-integration with correct endpoint and body", async () => {
		await processCommandJob(testJobData, deps);
		expect(deps.monicaClient.fetch).toHaveBeenCalledWith(
			"/internal/contacts",
			expect.objectContaining({
				method: "POST",
				body: expect.any(String),
			}),
		);
	});

	it("completes idempotency key on success", async () => {
		await processCommandJob(testJobData, deps);
		expect(deps.idempotencyStore.complete).toHaveBeenCalledWith(
			testJobData.command.idempotencyKey,
			expect.anything(),
		);
	});

	it("throws on monica-integration error to trigger BullMQ retry", async () => {
		(deps.monicaClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ error: "Failed" }), { status: 500 }),
		);
		await expect(processCommandJob(testJobData, deps)).rejects.toThrow(
			"monica-integration returned 500",
		);
	});

	it("sends success delivery intent on completion", async () => {
		await processCommandJob(testJobData, deps);
		expect(deps.deliveryClient.fetch).toHaveBeenCalled();
	});
});
