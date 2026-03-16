import { z } from "zod/v4";
import { AccountRef } from "./common.js";
import { EmbeddedContact } from "./contact.js";

/** Activity type category embedded in activity type. */
export const ActivityTypeCategory = z.object({
	id: z.number().int(),
	uuid: z.string(),
	object: z.literal("activityTypeCategory"),
	name: z.string(),
	account: AccountRef,
	created_at: z.string().nullable(),
	updated_at: z.string().nullable(),
});
export type ActivityTypeCategory = z.infer<typeof ActivityTypeCategory>;

/** Activity type object. */
export const ActivityType = z.object({
	id: z.number().int(),
	uuid: z.string(),
	object: z.literal("activityType"),
	name: z.string(),
	location_type: z.string().nullable(),
	activity_type_category: ActivityTypeCategory,
	account: AccountRef,
	created_at: z.string().nullable(),
	updated_at: z.string().nullable(),
});
export type ActivityType = z.infer<typeof ActivityType>;

/** Attendees section of an activity. */
const ActivityAttendees = z.object({
	total: z.number().int(),
	contacts: z.array(EmbeddedContact),
});

/** Activity resource object from Monica API. */
export const Activity = z.object({
	id: z.number().int(),
	uuid: z.string(),
	object: z.literal("activity"),
	summary: z.string(),
	description: z.string().nullable(),
	happened_at: z.string(),
	activity_type: ActivityType.nullable(),
	attendees: ActivityAttendees,
	emotions: z.array(z.unknown()),
	url: z.string(),
	account: AccountRef,
	created_at: z.string(),
	updated_at: z.string(),
});
export type Activity = z.infer<typeof Activity>;

/** Request body for POST /api/activities (create activity). Uses .strict() for request validation. */
export const CreateActivityRequest = z
	.object({
		activity_type_id: z.number().int().nullable().optional(),
		summary: z.string().max(255),
		description: z.string().max(1000000).optional(),
		happened_at: z.string(),
		contacts: z.array(z.number().int()),
		emotions: z.array(z.number().int()).optional(),
	})
	.strict();
export type CreateActivityRequest = z.infer<typeof CreateActivityRequest>;
