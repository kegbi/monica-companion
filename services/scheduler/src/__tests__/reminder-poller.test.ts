import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollReminders, type ReminderPollerDeps } from "../workers/reminder-poller";

function createMockDeps(): ReminderPollerDeps {
	return {
		userManagementClient: {
			fetch: vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						data: [
							{
								userId: "user-1",
								reminderCadence: "daily",
								reminderTime: "08:00",
								timezone: "UTC",
								connectorType: "telegram",
								connectorRoutingId: "chat-1",
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			),
		},
		db: {
			execute: vi.fn().mockResolvedValue([]),
		},
		reminderQueue: {
			add: vi.fn().mockResolvedValue({ id: "job-1" }),
		},
		catchUpWindowHours: 6,
	};
}

describe("pollReminders", () => {
	let deps: ReminderPollerDeps;

	beforeEach(() => {
		deps = createMockDeps();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("fetches users from user-management", async () => {
		await pollReminders(deps);
		expect(deps.userManagementClient.fetch).toHaveBeenCalledWith(
			"/internal/users/with-schedules",
			expect.anything(),
		);
	});

	it("enqueues reminder job when firing time is due", async () => {
		// Use a time that has already passed so the schedule is due
		const now = new Date("2026-03-17T09:00:00Z");
		vi.useFakeTimers();
		vi.setSystemTime(now);

		// The user wants 08:00 UTC daily, and now is 09:00 UTC
		// The insert returns a row (meaning dedupe key was new)
		(deps.db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: "window-1" }]);

		await pollReminders(deps);
		expect(deps.reminderQueue.add).toHaveBeenCalled();

		vi.useRealTimers();
	});

	it("skips user when dedupe key already exists", async () => {
		const now = new Date("2026-03-17T09:00:00Z");
		vi.useFakeTimers();
		vi.setSystemTime(now);

		// The insert returns empty (dedupe key conflict)
		(deps.db.execute as ReturnType<typeof vi.fn>).mockResolvedValue([]);

		await pollReminders(deps);
		expect(deps.reminderQueue.add).not.toHaveBeenCalled();

		vi.useRealTimers();
	});

	it("handles empty user list gracefully", async () => {
		(deps.userManagementClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ data: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		await pollReminders(deps);
		expect(deps.reminderQueue.add).not.toHaveBeenCalled();
	});
});
