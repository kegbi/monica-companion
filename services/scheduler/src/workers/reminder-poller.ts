import type { ServiceClient } from "@monica-companion/auth";
import { trace } from "@opentelemetry/api";
import { sql } from "drizzle-orm";
import {
	computeDedupeKey,
	computeNextFiringUtc,
	getIsoWeekString,
	getLocalDateString,
	isWithinCatchUpWindow,
} from "../lib/schedule-time";

const tracer = trace.getTracer("scheduler");

export interface ReminderPollerDeps {
	userManagementClient: ServiceClient;
	db: { execute: (query: unknown) => Promise<unknown[]> };
	reminderQueue: { add: (name: string, data: unknown) => Promise<unknown> };
	catchUpWindowHours: number;
}

interface UserSchedule {
	userId: string;
	reminderCadence: string;
	reminderTime: string;
	timezone: string;
	connectorType: string;
	connectorRoutingId: string;
}

/**
 * Polls for users with active reminder schedules and enqueues
 * individual reminder-execute jobs for those whose firing time is due.
 * Includes bounded catch-up logic for missed windows.
 */
export async function pollReminders(deps: ReminderPollerDeps): Promise<void> {
	await tracer.startActiveSpan("scheduler.poll_reminders", async (span) => {
		try {
			const response = await deps.userManagementClient.fetch("/internal/users/with-schedules", {
				method: "GET",
			});

			if (!response.ok) {
				span.setAttribute("scheduler.error", `user-management returned ${response.status}`);
				return;
			}

			const { data: users } = (await response.json()) as { data: UserSchedule[] };
			span.setAttribute("scheduler.user_count", users.length);

			const now = new Date();

			for (const user of users) {
				await processUserSchedule(user, now, deps);
			}
		} catch (err) {
			span.setAttribute("scheduler.status", "failed");
			if (err instanceof Error) {
				span.setAttribute("scheduler.error", err.message);
			}
			// Don't throw -- let the repeatable job continue
		} finally {
			span.end();
		}
	});
}

async function processUserSchedule(
	user: UserSchedule,
	now: Date,
	deps: ReminderPollerDeps,
): Promise<void> {
	const cadence = user.reminderCadence as "daily" | "weekly";
	if (cadence !== "daily" && cadence !== "weekly") return;

	const firingUtc = computeNextFiringUtc(user.timezone, user.reminderTime, cadence, now);

	// Check current window
	if (firingUtc.getTime() <= now.getTime()) {
		const windowId =
			cadence === "daily"
				? getLocalDateString(user.timezone, now)
				: getIsoWeekString(user.timezone, now);

		const dedupeKey = computeDedupeKey(user.userId, cadence, windowId);
		const enqueued = await tryInsertWindow(
			deps,
			user.userId,
			dedupeKey,
			cadence,
			firingUtc,
			"pending",
		);
		if (enqueued) {
			await deps.reminderQueue.add("execute-reminder", {
				userId: user.userId,
				connectorType: user.connectorType,
				connectorRoutingId: user.connectorRoutingId,
				correlationId: `reminder:${user.userId}:${windowId}`,
				windowId: dedupeKey,
			});
		}
	}

	// Check catch-up: look at the previous window
	await checkCatchUpWindow(user, cadence, now, deps);
}

async function checkCatchUpWindow(
	user: UserSchedule,
	cadence: "daily" | "weekly",
	now: Date,
	deps: ReminderPollerDeps,
): Promise<void> {
	// Compute what the previous window's firing time would have been
	const previousDate = new Date(
		now.getTime() - (cadence === "daily" ? 24 : 7 * 24) * 60 * 60 * 1000,
	);
	const prevFiringUtc = computeNextFiringUtc(
		user.timezone,
		user.reminderTime,
		cadence,
		previousDate,
	);

	// Only consider if it's in the past and within catch-up window
	if (prevFiringUtc.getTime() < now.getTime()) {
		const windowId =
			cadence === "daily"
				? getLocalDateString(user.timezone, prevFiringUtc)
				: getIsoWeekString(user.timezone, prevFiringUtc);

		const dedupeKey = computeDedupeKey(user.userId, cadence, windowId);

		if (isWithinCatchUpWindow(prevFiringUtc, now, deps.catchUpWindowHours)) {
			const enqueued = await tryInsertWindow(
				deps,
				user.userId,
				dedupeKey,
				cadence,
				prevFiringUtc,
				"catch_up",
			);
			if (enqueued) {
				await deps.reminderQueue.add("execute-reminder", {
					userId: user.userId,
					connectorType: user.connectorType,
					connectorRoutingId: user.connectorRoutingId,
					correlationId: `reminder:${user.userId}:${windowId}`,
					windowId: dedupeKey,
				});
			}
		} else {
			// Outside catch-up window: mark as skipped to prevent re-processing
			await tryInsertWindow(deps, user.userId, dedupeKey, cadence, prevFiringUtc, "skipped");
		}
	}
}

async function tryInsertWindow(
	deps: ReminderPollerDeps,
	userId: string,
	dedupeKey: string,
	cadence: string,
	scheduledAt: Date,
	status: string,
): Promise<boolean> {
	const inserted = (await deps.db.execute(
		sql`INSERT INTO reminder_windows (user_id, dedupe_key, cadence, scheduled_at, status)
			VALUES (${userId}, ${dedupeKey}, ${cadence}, ${scheduledAt.toISOString()}, ${status})
			ON CONFLICT (dedupe_key) DO NOTHING
			RETURNING id`,
	)) as Array<{ id: string }>;

	return inserted.length > 0;
}
