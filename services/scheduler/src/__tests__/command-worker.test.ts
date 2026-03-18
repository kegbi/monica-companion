import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/api", () => ({
	trace: {
		getTracer: () => ({
			startActiveSpan: (_name: string, fn: (span: unknown) => unknown) =>
				fn({
					setAttribute: () => {},
					end: () => {},
				}),
		}),
	},
}));

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
		userManagementClient: {
			fetch: vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						reminderCadence: "daily",
						reminderTime: "08:00",
						timezone: "UTC",
						connectorType: "telegram",
						connectorRoutingId: "chat-resolved-123",
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			),
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

	it("resolves connectorType and connectorRoutingId from user-management when absent from job data", async () => {
		await processCommandJob(testJobData, deps);
		// Should have called user-management to resolve connector routing
		expect(deps.userManagementClient.fetch).toHaveBeenCalledWith(
			expect.stringContaining("/internal/users/"),
			expect.anything(),
		);
		// Delivery intent should use resolved values
		const deliveryCall = (deps.deliveryClient.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(deliveryCall[1].body);
		expect(body.connectorType).toBe("telegram");
		expect(body.connectorRoutingId).toBe("chat-resolved-123");
	});

	it("uses connectorType and connectorRoutingId from job data when present", async () => {
		const jobWithConnector = {
			...testJobData,
			command: {
				...testJobData.command,
				connectorType: "whatsapp",
				connectorRoutingId: "wa-chat-456",
			},
		};
		await processCommandJob(jobWithConnector, deps);
		// Should NOT have called user-management
		expect(deps.userManagementClient.fetch).not.toHaveBeenCalled();
		// Delivery intent should use provided values
		const deliveryCall = (deps.deliveryClient.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(deliveryCall[1].body);
		expect(body.connectorType).toBe("whatsapp");
		expect(body.connectorRoutingId).toBe("wa-chat-456");
	});

	it("regression: connectorRoutingId is never empty string (F3 bug)", async () => {
		await processCommandJob(testJobData, deps);
		const deliveryCall = (deps.deliveryClient.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(deliveryCall[1].body);
		expect(body.connectorRoutingId).not.toBe("");
		expect(body.connectorRoutingId.length).toBeGreaterThan(0);
	});
});
