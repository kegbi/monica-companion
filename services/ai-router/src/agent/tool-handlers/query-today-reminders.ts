import type { ServiceClient } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";

const logger = createLogger("ai-router:query-today-reminders-handler");

export interface QueryTodayRemindersParams {
	serviceClient: ServiceClient;
	userId: string;
	correlationId: string;
}

interface ReminderEntry {
	reminderId: number;
	plannedDate: string;
	title: string;
	description: string | null;
	contactId: number;
	contactName: string;
}

export type QueryTodayRemindersResponse =
	| { status: "ok"; reminders: ReminderEntry[]; date: string }
	| { status: "error"; message: string };

/**
 * Handle a query_today_reminders tool call.
 *
 * Fetches today's reminders from monica-integration's /reminders/today
 * endpoint. Returns structured results for the LLM.
 */
export async function handleQueryTodayReminders(
	params: QueryTodayRemindersParams,
): Promise<QueryTodayRemindersResponse> {
	const { serviceClient, userId, correlationId } = params;

	try {
		const response = await serviceClient.fetch("/internal/reminders/today", {
			userId,
			correlationId,
			signal: AbortSignal.timeout(30_000),
		});

		if (!response.ok) {
			logger.warn("Failed to fetch today's reminders", {
				correlationId,
				userId,
				status: response.status,
			});
			return {
				status: "error",
				message: "Unable to fetch today's reminders. Please try again later.",
			};
		}

		const data = (await response.json()) as { data: ReminderEntry[] };
		const today = new Date().toISOString().split("T")[0];

		return {
			status: "ok",
			reminders: data.data,
			date: today,
		};
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		logger.warn("Error querying today's reminders", {
			correlationId,
			userId,
			error: errMsg,
		});
		return {
			status: "error",
			message: "Unable to fetch today's reminders. Please try again later.",
		};
	}
}
