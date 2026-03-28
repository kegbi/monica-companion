import type { ServiceClient } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";

const logger = createLogger("ai-router:query-reminders-handler");

export interface QueryRemindersParams {
	serviceClient: ServiceClient;
	userId: string;
	correlationId: string;
	/** Number of days to look ahead (including today). Default 1. */
	days: number;
}

interface ReminderEntry {
	reminderId: number;
	plannedDate: string;
	title: string;
	description: string | null;
	contactId: number;
	contactName: string;
}

export type QueryRemindersResponse =
	| { status: "ok"; reminders: ReminderEntry[]; fromDate: string; toDate: string }
	| { status: "error"; message: string };

/**
 * Handle a query_reminders tool call.
 *
 * Fetches upcoming reminders from monica-integration for a date range.
 * Returns structured results for the LLM.
 */
export async function handleQueryReminders(
	params: QueryRemindersParams,
): Promise<QueryRemindersResponse> {
	const { serviceClient, userId, correlationId, days } = params;
	const clampedDays = Math.max(1, Math.min(days, 90));

	try {
		const response = await serviceClient.fetch(`/internal/reminders/range?days=${clampedDays}`, {
			userId,
			correlationId,
			signal: AbortSignal.timeout(30_000),
		});

		if (!response.ok) {
			logger.warn("Failed to fetch reminders", {
				correlationId,
				userId,
				status: response.status,
			});
			return {
				status: "error",
				message: "Unable to fetch reminders. Please try again later.",
			};
		}

		const data = (await response.json()) as {
			data: ReminderEntry[];
			fromDate: string;
			toDate: string;
		};

		return {
			status: "ok",
			reminders: data.data,
			fromDate: data.fromDate,
			toDate: data.toDate,
		};
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		logger.warn("Error querying reminders", {
			correlationId,
			userId,
			error: errMsg,
		});
		return {
			status: "error",
			message: "Unable to fetch reminders. Please try again later.",
		};
	}
}
