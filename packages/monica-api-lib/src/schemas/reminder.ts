import { z } from "zod/v4";
import { AccountRef } from "./common.js";
import { EmbeddedContact } from "./contact.js";

/** Valid frequency types for reminders. */
export const FrequencyType = z.enum(["one_time", "week", "month", "year"]);
export type FrequencyType = z.infer<typeof FrequencyType>;

/** Reminder resource object from Monica API. */
export const Reminder = z.object({
	id: z.number().int(),
	uuid: z.string(),
	object: z.literal("reminder"),
	title: z.string(),
	description: z.string().nullable(),
	frequency_type: FrequencyType,
	frequency_number: z.number().int(),
	initial_date: z.string(),
	delible: z.boolean(),
	account: AccountRef,
	contact: EmbeddedContact,
	created_at: z.string(),
	updated_at: z.string(),
});
export type Reminder = z.infer<typeof Reminder>;

/** Reminder outbox entry returned by GET /api/reminders/upcoming/{month}. */
export const ReminderOutbox = z.object({
	id: z.number().int(),
	reminder_id: z.number().int(),
	object: z.string(),
	planned_date: z.string(),
	title: z.string(),
	description: z.string().nullable(),
	frequency_type: FrequencyType,
	frequency_number: z.number().int(),
	initial_date: z.string(),
	delible: z.boolean(),
	account: AccountRef,
	contact: EmbeddedContact,
	created_at: z.string(),
	updated_at: z.string(),
});
export type ReminderOutbox = z.infer<typeof ReminderOutbox>;

/** Request body for POST /api/reminders (create reminder). Uses .strict() for request validation. */
export const CreateReminderRequest = z
	.object({
		title: z.string().max(100000),
		description: z.string().max(1000000).optional(),
		initial_date: z.string(),
		frequency_type: FrequencyType,
		frequency_number: z.number().int(),
		contact_id: z.number().int(),
		delible: z.boolean().optional(),
	})
	.strict();
export type CreateReminderRequest = z.infer<typeof CreateReminderRequest>;
