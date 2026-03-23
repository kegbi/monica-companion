import type { ServiceClient } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";

const logger = createLogger("ai-router:query-phone-handler");

export interface QueryPhoneParams {
	contactId: number;
	serviceClient: ServiceClient;
	userId: string;
	correlationId: string;
}

export type QueryPhoneResponse =
	| { status: "ok"; phones: Array<{ value: string; typeName: string }>; contactId: number }
	| { status: "error"; message: string };

/**
 * Handle a query_phone tool call.
 *
 * Fetches the contact's contact fields from monica-integration,
 * filters for phone type entries, and returns the phone values.
 */
export async function handleQueryPhone(params: QueryPhoneParams): Promise<QueryPhoneResponse> {
	const { contactId, serviceClient, userId, correlationId } = params;

	try {
		const response = await serviceClient.fetch(`/internal/contacts/${contactId}/contact-fields`, {
			userId,
			correlationId,
			signal: AbortSignal.timeout(30_000),
		});

		if (!response.ok) {
			logger.warn("Failed to fetch contact fields for phone query", {
				correlationId,
				userId,
				contactId,
				status: response.status,
			});
			return {
				status: "error",
				message: `Unable to look up phone for contact ${contactId}. Please verify the contact ID and try again.`,
			};
		}

		const data = (await response.json()) as {
			data: Array<{ type: string | null; typeName: string; value: string }>;
		};

		const phones = data.data
			.filter((f) => f.type === "phone")
			.map((f) => ({ value: f.value, typeName: f.typeName }));

		return { status: "ok", phones, contactId };
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		logger.warn("Error querying phone", {
			correlationId,
			userId,
			contactId,
			error: errMsg,
		});
		return {
			status: "error",
			message: "Unable to look up the phone number. Please try again later.",
		};
	}
}
