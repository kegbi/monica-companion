import type { ServiceClient } from "@monica-companion/auth";

export interface DeliveryRouting {
	connectorType: string;
	connectorRoutingId: string;
}

export interface UserPreferences {
	language: string;
	confirmationMode: string;
	timezone: string;
}

export interface UserManagementClient {
	getDeliveryRouting(userId: string, correlationId: string): Promise<DeliveryRouting>;
	getPreferences(userId: string, correlationId: string): Promise<UserPreferences>;
}

export function createUserManagementClient(serviceClient: ServiceClient): UserManagementClient {
	return {
		async getDeliveryRouting(userId: string, correlationId: string) {
			const signal = AbortSignal.timeout(5_000);
			const res = await serviceClient.fetch(`/internal/users/${userId}/delivery-routing`, {
				method: "GET",
				correlationId,
				userId,
				signal,
			});

			if (!res.ok) {
				throw new Error(`user-management delivery-routing returned ${res.status}`);
			}

			return (await res.json()) as DeliveryRouting;
		},

		async getPreferences(userId: string, correlationId: string) {
			const signal = AbortSignal.timeout(5_000);
			const res = await serviceClient.fetch(`/internal/users/${userId}/preferences`, {
				method: "GET",
				correlationId,
				userId,
				signal,
			});

			if (!res.ok) {
				throw new Error(`user-management preferences returned ${res.status}`);
			}

			return (await res.json()) as UserPreferences;
		},
	};
}
