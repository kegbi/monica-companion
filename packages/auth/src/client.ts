import type { ServiceName } from "./schemas";
import { signServiceToken } from "./token";

type FetchFn = typeof globalThis.fetch;

export interface ServiceClientOptions {
	issuer: ServiceName;
	audience: ServiceName;
	secret: string;
	baseUrl: string;
	fetch?: FetchFn;
}

export interface ServiceFetchOptions extends Omit<RequestInit, "headers"> {
	headers?: Record<string, string>;
	userId?: string;
	correlationId?: string;
}

export interface ServiceClient {
	fetch(path: string, options?: ServiceFetchOptions): Promise<Response>;
}

export function createServiceClient(options: ServiceClientOptions): ServiceClient {
	const { issuer, audience, secret, baseUrl, fetch: fetchFn = globalThis.fetch } = options;

	return {
		async fetch(path: string, fetchOptions: ServiceFetchOptions = {}): Promise<Response> {
			const { userId, correlationId, headers: customHeaders, ...init } = fetchOptions;

			const token = await signServiceToken({
				issuer,
				audience,
				secret,
				subject: userId,
				correlationId,
			});

			const headers: Record<string, string> = {
				...customHeaders,
				Authorization: `Bearer ${token}`,
			};

			if (correlationId) {
				headers["X-Correlation-ID"] = correlationId;
			}

			const url = `${baseUrl}${path}`;
			return fetchFn(url, { ...init, headers });
		},
	};
}
