import { createServiceClient, type ServiceClient } from "@monica-companion/auth";
import type { ConnectorUserLookupResponse } from "@monica-companion/types";

export interface UserManagementClientOptions {
	baseUrl: string;
	secret: string;
	timeoutMs?: number;
}

export interface UserManagementClient extends ServiceClient {
	lookupByConnector(
		connectorType: string,
		connectorUserId: string,
		correlationId?: string,
	): Promise<ConnectorUserLookupResponse>;
}

export function createUserManagementClient(
	options: UserManagementClientOptions,
): UserManagementClient {
	const base = createServiceClient({
		issuer: "telegram-bridge",
		audience: "user-management",
		secret: options.secret,
		baseUrl: options.baseUrl,
	});

	return {
		fetch: base.fetch.bind(base),
		async lookupByConnector(
			connectorType: string,
			connectorUserId: string,
			correlationId?: string,
		): Promise<ConnectorUserLookupResponse> {
			const signal = AbortSignal.timeout(options.timeoutMs ?? 5000);
			const res = await base.fetch(
				`/internal/users/by-connector/${connectorType}/${connectorUserId}`,
				{ correlationId, signal },
			);
			if (!res.ok) {
				throw new Error(`User lookup failed with status ${res.status}`);
			}
			return res.json();
		},
	};
}
