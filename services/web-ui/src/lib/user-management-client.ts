import { createServiceClient, type ServiceClient } from "@monica-companion/auth";

let client: ServiceClient | null = null;

export function getUserManagementClient(): ServiceClient {
	if (client) return client;

	const baseUrl = import.meta.env.USER_MANAGEMENT_URL || process.env.USER_MANAGEMENT_URL;
	const secret = import.meta.env.JWT_SECRET || process.env.JWT_SECRET;

	if (!baseUrl || !secret) {
		throw new Error("USER_MANAGEMENT_URL and JWT_SECRET environment variables are required");
	}

	client = createServiceClient({
		issuer: "web-ui",
		audience: "user-management",
		secret,
		baseUrl,
	});

	return client;
}
