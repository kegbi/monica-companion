import { createServiceClient, type ServiceClient } from "@monica-companion/auth";

export interface UserManagementClientOptions {
	baseUrl: string;
	secret: string;
}

export function createUserManagementClient(options: UserManagementClientOptions): ServiceClient {
	return createServiceClient({
		issuer: "telegram-bridge",
		audience: "user-management",
		secret: options.secret,
		baseUrl: options.baseUrl,
	});
}
