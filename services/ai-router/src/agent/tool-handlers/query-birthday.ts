import type { ServiceClient } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";

const logger = createLogger("ai-router:query-birthday-handler");

export interface QueryBirthdayParams {
	contactId: number;
	serviceClient: ServiceClient;
	userId: string;
	correlationId: string;
}

export type QueryBirthdayResponse =
	| { status: "ok"; birthday: string | null; isYearUnknown: boolean; contactId: number }
	| { status: "error"; message: string };

/**
 * Handle a query_birthday tool call.
 *
 * Fetches the contact from monica-integration and extracts the
 * birthdate from the importantDates array. Returns structured
 * results for the LLM.
 */
export async function handleQueryBirthday(
	params: QueryBirthdayParams,
): Promise<QueryBirthdayResponse> {
	const { contactId, serviceClient, userId, correlationId } = params;

	try {
		const response = await serviceClient.fetch(`/internal/contacts/${contactId}`, {
			userId,
			correlationId,
			signal: AbortSignal.timeout(30_000),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "unknown");
			logger.warn("Failed to fetch contact for birthday query", {
				correlationId,
				userId,
				contactId,
				status: response.status,
			});
			return {
				status: "error",
				message: `Unable to look up contact ${contactId}. Please verify the contact ID and try again.`,
			};
		}

		const data = (await response.json()) as {
			importantDates: Array<{ label: string; date: string; isYearUnknown: boolean }>;
		};

		const birthdateEntry = data.importantDates?.find((d) => d.label.toLowerCase() === "birthdate");

		return {
			status: "ok",
			birthday: birthdateEntry?.date ?? null,
			isYearUnknown: birthdateEntry?.isYearUnknown ?? false,
			contactId,
		};
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		logger.warn("Error querying birthday", {
			correlationId,
			userId,
			contactId,
			error: errMsg,
		});
		return {
			status: "error",
			message: "Unable to look up the birthday. Please try again later.",
		};
	}
}
