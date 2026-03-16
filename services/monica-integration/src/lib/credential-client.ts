import type { ServiceClient } from "@monica-companion/auth";
import { z } from "zod/v4";

const MonicaCredentialsResponse = z.object({
	baseUrl: z.string(),
	apiToken: z.string(),
});

export type MonicaCredentials = z.infer<typeof MonicaCredentialsResponse>;

/** Error thrown when credential resolution from user-management fails. */
export class CredentialResolutionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CredentialResolutionError";
	}
}

/**
 * Fetch Monica API credentials for a given user from user-management.
 * Credential data (baseUrl, apiToken) must NEVER be logged.
 */
export async function fetchMonicaCredentials(
	serviceClient: ServiceClient,
	userId: string,
	correlationId: string,
): Promise<MonicaCredentials> {
	let response: Response;
	try {
		response = await serviceClient.fetch(`/internal/users/${userId}/monica-credentials`, {
			userId,
			correlationId,
		});
	} catch (err) {
		throw new CredentialResolutionError(
			`Failed to reach user-management for credential resolution: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (!response.ok) {
		throw new CredentialResolutionError(
			`Credential resolution failed with status ${response.status}`,
		);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new CredentialResolutionError("Invalid response body from credential resolution");
	}

	const parsed = MonicaCredentialsResponse.safeParse(body);
	if (!parsed.success) {
		throw new CredentialResolutionError("Credential response does not match expected schema");
	}

	return parsed.data;
}
