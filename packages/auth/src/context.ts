import type { Context } from "hono";
import type { ServiceName } from "./schemas";

export interface AuthVariables {
	serviceCaller: ServiceName;
	userId: string | undefined;
	correlationId: string;
}

export function getServiceCaller(c: Context): ServiceName {
	return c.get("serviceCaller");
}

export function getUserId(c: Context): string | undefined {
	return c.get("userId");
}

export function getCorrelationId(c: Context): string {
	return c.get("correlationId");
}
