import { createServiceClient } from "@monica-companion/auth";
import {
	MonicaApiClient,
	MonicaApiError,
	MonicaUrlValidationError,
	normalizeMonicaUrl,
	validateMonicaUrl,
} from "@monica-companion/monica-api-lib";
import { createLogger } from "@monica-companion/observability";
import type { Context } from "hono";
import type { Config } from "../config.js";
import { fetchMonicaCredentials } from "../lib/credential-client.js";

const logger = createLogger("monica-integration");

/**
 * Create a MonicaApiClient for the given user by resolving credentials
 * from user-management. The client is instantiated per-request and does
 * not cache credentials beyond the request lifetime.
 *
 * Normalizes and validates the user's Monica base URL before creating
 * the client. Throws MonicaUrlValidationError on invalid/dangerous URLs.
 */
export async function createMonicaClient(
	config: Config,
	userId: string,
	correlationId: string,
): Promise<MonicaApiClient> {
	const serviceClient = createServiceClient({
		issuer: "monica-integration",
		audience: "user-management",
		secret: config.auth.jwtSecrets[0],
		baseUrl: config.userManagementUrl,
	});

	const credentials = await fetchMonicaCredentials(serviceClient, userId, correlationId);

	// Normalize and validate the Monica base URL (SSRF protection)
	const canonicalUrl = normalizeMonicaUrl(credentials.baseUrl);
	await validateMonicaUrl(canonicalUrl, {
		allowPrivateNetworkTargets: config.allowPrivateNetworkTargets,
	});

	return new MonicaApiClient({
		baseUrl: canonicalUrl,
		apiToken: credentials.apiToken,
		timeoutMs: config.monicaDefaultTimeoutMs,
		retryOptions: { maxRetries: config.monicaRetryMax, baseDelayMs: 500, maxDelayMs: 5000 },
		logger,
	});
}

/**
 * Shared error handler for Monica API and URL validation errors.
 * Extracted from route files to eliminate duplication (DRY).
 */
export function handleMonicaError(c: Context, err: unknown) {
	if (err instanceof MonicaUrlValidationError) {
		// Return 422 with a generic message -- never leak URL or IP details.
		return c.json({ error: "Invalid Monica instance URL" }, 422);
	}
	if (err instanceof MonicaApiError) {
		const status = err.statusCode >= 500 ? 502 : err.statusCode;
		return c.json({ error: "Monica API error" }, status as 400);
	}
	if (err instanceof Error && err.name === "CredentialResolutionError") {
		return c.json({ error: "Failed to resolve user credentials" }, 502);
	}
	throw err;
}
