import type { ServiceClient } from "@monica-companion/auth";
import { trace } from "@opentelemetry/api";
import { sql } from "drizzle-orm";

const tracer = trace.getTracer("scheduler");

export interface ReminderExecutorDeps {
	monicaClient: ServiceClient;
	deliveryClient: ServiceClient;
	db: { execute: (query: unknown) => Promise<unknown> };
}

export interface ReminderJobData {
	userId: string;
	connectorType: "telegram";
	connectorRoutingId: string;
	correlationId: string;
	windowId: string;
}

interface UpcomingReminder {
	reminderId: number;
	plannedDate: string;
	title: string;
	description: string;
	contactId: number;
	contactName: string;
}

/**
 * Executes a single user's reminder: fetches upcoming reminders from
 * monica-integration, formats a digest, and emits an OutboundMessageIntent
 * to the delivery service.
 */
export async function executeReminder(
	data: ReminderJobData,
	deps: ReminderExecutorDeps,
): Promise<void> {
	await tracer.startActiveSpan("scheduler.execute_reminder", async (span) => {
		span.setAttribute("scheduler.user_id", data.userId);
		span.setAttribute("scheduler.window_id", data.windowId);

		try {
			// Fetch upcoming reminders from monica-integration
			const response = await deps.monicaClient.fetch("/internal/reminders/upcoming", {
				method: "GET",
				userId: data.userId,
				correlationId: data.correlationId,
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => "unknown error");
				throw new Error(`monica-integration returned ${response.status}: ${errorText}`);
			}

			const { data: reminders } = (await response.json()) as { data: UpcomingReminder[] };

			// Format connector-neutral digest text
			const digestText = formatReminderDigest(reminders);

			// Emit OutboundMessageIntent to delivery
			await deps.deliveryClient.fetch("/internal/deliver", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					userId: data.userId,
					connectorType: data.connectorType,
					connectorRoutingId: data.connectorRoutingId,
					correlationId: data.correlationId,
					content: {
						type: "text",
						text: digestText,
					},
				}),
				userId: data.userId,
				correlationId: data.correlationId,
			});

			// Update reminder window status to sent
			await deps.db.execute(
				sql`UPDATE reminder_windows SET status = 'sent', fired_at = NOW()
					WHERE dedupe_key = ${data.windowId}`,
			);

			span.setAttribute("scheduler.reminder_count", reminders.length);
			span.setAttribute("scheduler.status", "completed");
		} catch (err) {
			span.setAttribute("scheduler.status", "failed");
			if (err instanceof Error) {
				span.setAttribute("scheduler.error", err.message);
			}
			throw err;
		} finally {
			span.end();
		}
	});
}

function formatReminderDigest(reminders: UpcomingReminder[]): string {
	if (reminders.length === 0) {
		return "No upcoming reminders for today.";
	}

	const lines = reminders.map((r) => `- ${r.contactName}: ${r.title} (${r.plannedDate})`);
	return `Upcoming reminders:\n${lines.join("\n")}`;
}
