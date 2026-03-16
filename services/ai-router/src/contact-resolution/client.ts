import type { ServiceClient } from "@monica-companion/auth";
import { ContactResolutionSummary } from "@monica-companion/types";
import { z } from "zod/v4";

/** Timeout for HTTP calls to monica-integration (30 seconds). */
const CLIENT_TIMEOUT_MS = 30_000;

/** Response shape from the resolution-summaries endpoint. */
const ResolutionSummariesResponse = z.object({
	data: z.array(ContactResolutionSummary),
});

/** Error thrown when the contact resolution client call fails. */
export class ContactResolutionClientError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ContactResolutionClientError";
	}
}

/**
 * Fetch contact resolution summaries from monica-integration.
 *
 * Uses the service client for authenticated service-to-service calls.
 * Validates the response against the expected Zod schema.
 * Applies an explicit timeout per reliability rules.
 */
export async function fetchContactSummaries(
	serviceClient: ServiceClient,
	userId: string,
	correlationId: string,
): Promise<z.infer<typeof ContactResolutionSummary>[]> {
	let response: Response;
	try {
		response = await serviceClient.fetch("/internal/contacts/resolution-summaries", {
			userId,
			correlationId,
			signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
		});
	} catch (err) {
		throw new ContactResolutionClientError(
			`Failed to reach monica-integration: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (!response.ok) {
		throw new ContactResolutionClientError(`monica-integration returned status ${response.status}`);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new ContactResolutionClientError("Invalid JSON response from monica-integration");
	}

	const parsed = ResolutionSummariesResponse.safeParse(body);
	if (!parsed.success) {
		throw new ContactResolutionClientError(
			"Response from monica-integration does not match expected schema",
		);
	}

	return parsed.data.data;
}
