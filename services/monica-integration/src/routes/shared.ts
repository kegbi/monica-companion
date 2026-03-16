import { createServiceClient } from "@monica-companion/auth";
import { MonicaApiClient } from "@monica-companion/monica-api-lib";
import { createLogger } from "@monica-companion/observability";
import type { Config } from "../config.js";
import { fetchMonicaCredentials } from "../lib/credential-client.js";

const logger = createLogger("monica-integration");

/**
 * Create a MonicaApiClient for the given user by resolving credentials
 * from user-management. The client is instantiated per-request and does
 * not cache credentials beyond the request lifetime.
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

	return new MonicaApiClient({
		baseUrl: credentials.baseUrl,
		apiToken: credentials.apiToken,
		timeoutMs: config.monicaDefaultTimeoutMs,
		retryOptions: { maxRetries: config.monicaRetryMax, baseDelayMs: 500, maxDelayMs: 5000 },
		logger,
	});
}
