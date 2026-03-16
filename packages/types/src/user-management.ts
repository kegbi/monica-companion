import { z } from "zod/v4";

/** Response schema for non-secret user preferences. */
export const UserPreferencesResponse = z.object({
	language: z.string(),
	confirmationMode: z.string(),
	timezone: z.string(),
});
export type UserPreferencesResponse = z.infer<typeof UserPreferencesResponse>;

/** Response schema for schedule-relevant user settings. */
export const UserScheduleResponse = z.object({
	reminderCadence: z.string(),
	reminderTime: z.string(),
	timezone: z.string(),
	connectorType: z.string(),
	connectorRoutingId: z.string(),
});
export type UserScheduleResponse = z.infer<typeof UserScheduleResponse>;

/** Response schema for Monica API credentials (secret, never log). */
export const MonicaCredentialsResponse = z.object({
	baseUrl: z.string(),
	apiToken: z.string(),
});
export type MonicaCredentialsResponse = z.infer<typeof MonicaCredentialsResponse>;
