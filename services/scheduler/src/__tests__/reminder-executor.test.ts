import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeReminder, type ReminderExecutorDeps } from "../workers/reminder-executor";

function createMockDeps(): ReminderExecutorDeps {
	return {
		monicaClient: {
			fetch: vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						data: [
							{
								reminderId: 1,
								plannedDate: "2026-03-17",
								title: "Birthday",
								description: "Call Jane",
								contactId: 42,
								contactName: "Jane Doe",
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			),
		},
		deliveryClient: {
			fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
		},
		db: {
			execute: vi.fn().mockResolvedValue([]),
		},
	};
}

const testJobData = {
	userId: "user-1",
	connectorType: "telegram" as const,
	connectorRoutingId: "chat-1",
	correlationId: "corr-reminder-1",
	windowId: "window-1",
};

describe("executeReminder", () => {
	let deps: ReminderExecutorDeps;

	beforeEach(() => {
		deps = createMockDeps();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("fetches upcoming reminders from monica-integration", async () => {
		await executeReminder(testJobData, deps);
		expect(deps.monicaClient.fetch).toHaveBeenCalledWith(
			"/internal/reminders/upcoming",
			expect.anything(),
		);
	});

	it("sends OutboundMessageIntent to delivery", async () => {
		await executeReminder(testJobData, deps);
		expect(deps.deliveryClient.fetch).toHaveBeenCalled();
		const callArgs = (deps.deliveryClient.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(callArgs[0]).toBe("/internal/deliver");
		const body = JSON.parse(callArgs[1].body);
		expect(body.userId).toBe("user-1");
		expect(body.connectorType).toBe("telegram");
		expect(body.content.type).toBe("text");
		expect(body.content.text).toContain("Jane Doe");
	});

	it("updates reminder window status to sent", async () => {
		await executeReminder(testJobData, deps);
		expect(deps.db.execute).toHaveBeenCalled();
	});

	it("handles no upcoming reminders gracefully", async () => {
		(deps.monicaClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ data: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		await executeReminder(testJobData, deps);
		// Should still update status, just with "no reminders" message
		expect(deps.db.execute).toHaveBeenCalled();
	});

	it("throws on monica-integration failure to trigger retry", async () => {
		(deps.monicaClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ error: "Failed" }), { status: 500 }),
		);
		await expect(executeReminder(testJobData, deps)).rejects.toThrow();
	});
});
