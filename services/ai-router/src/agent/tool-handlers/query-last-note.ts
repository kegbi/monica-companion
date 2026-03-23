import type { ServiceClient } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";

const logger = createLogger("ai-router:query-last-note-handler");

export interface QueryLastNoteParams {
	contactId: number;
	serviceClient: ServiceClient;
	userId: string;
	correlationId: string;
}

export type QueryLastNoteResponse =
	| { status: "ok"; note: { body: string; createdAt: string } | null; contactId: number }
	| { status: "error"; message: string };

/**
 * Handle a query_last_note tool call.
 *
 * Fetches the most recent note for a contact from monica-integration
 * (using limit=1) and returns the note body and creation date.
 */
export async function handleQueryLastNote(
	params: QueryLastNoteParams,
): Promise<QueryLastNoteResponse> {
	const { contactId, serviceClient, userId, correlationId } = params;

	try {
		const response = await serviceClient.fetch(`/internal/contacts/${contactId}/notes?limit=1`, {
			userId,
			correlationId,
			signal: AbortSignal.timeout(30_000),
		});

		if (!response.ok) {
			logger.warn("Failed to fetch notes for last note query", {
				correlationId,
				userId,
				contactId,
				status: response.status,
			});
			return {
				status: "error",
				message: `Unable to look up notes for contact ${contactId}. Please verify the contact ID and try again.`,
			};
		}

		const data = (await response.json()) as {
			data: Array<{ body: string; createdAt: string }>;
		};

		const firstNote = data.data[0] ?? null;

		return {
			status: "ok",
			note: firstNote ? { body: firstNote.body, createdAt: firstNote.createdAt } : null,
			contactId,
		};
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		logger.warn("Error querying last note", {
			correlationId,
			userId,
			contactId,
			error: errMsg,
		});
		return {
			status: "error",
			message: "Unable to look up the note. Please try again later.",
		};
	}
}
