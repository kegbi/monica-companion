import { z } from "zod/v4";
import { AccountRef, Avatar, MonicaDateField } from "./common.js";
import { Tag } from "./tag.js";

/** Embedded contact (short form) used inside notes, reminders, activities, etc. */
export const EmbeddedContact = z.object({
	id: z.number().int(),
	uuid: z.string(),
	object: z.literal("contact"),
	hash_id: z.string(),
	first_name: z.string(),
	last_name: z.string().nullable(),
	nickname: z.string().nullable(),
	complete_name: z.string(),
	initials: z.string(),
	gender: z.string(),
	gender_type: z.string(),
	is_starred: z.boolean(),
	is_partial: z.boolean(),
	is_active: z.boolean(),
	is_dead: z.boolean(),
	is_me: z.boolean(),
	information: z.object({
		birthdate: MonicaDateField,
		deceased_date: MonicaDateField,
		avatar: Avatar,
	}),
	url: z.string(),
	account: AccountRef,
});
export type EmbeddedContact = z.infer<typeof EmbeddedContact>;

/** RelationshipShort object embedded in full contact's information.relationships.{group}.contacts[]. */
export const RelationshipShort = z.object({
	relationship: z.object({
		id: z.number().int(),
		uuid: z.string(),
		name: z.string(),
	}),
	contact: EmbeddedContact,
});
export type RelationshipShort = z.infer<typeof RelationshipShort>;

/** Relationship group (love, family, friend, work) within full contact. */
const RelationshipGroup = z.object({
	total: z.number().int(),
	contacts: z.array(RelationshipShort),
});

/** Statistics section of the full contact object. */
const ContactStatistics = z.object({
	number_of_calls: z.number().int(),
	number_of_notes: z.number().int(),
	number_of_activities: z.number().int(),
	number_of_reminders: z.number().int(),
	number_of_tasks: z.number().int(),
	number_of_gifts: z.number().int(),
	number_of_debts: z.number().int(),
});

/** Address object (imported inline to avoid circular deps; full shape in address.ts). */
const AddressInline = z.object({
	id: z.number().int(),
	uuid: z.string(),
	object: z.literal("address"),
	name: z.string().nullable(),
	street: z.string().nullable(),
	city: z.string().nullable(),
	province: z.string().nullable(),
	postal_code: z.string().nullable(),
	latitude: z.number().nullable(),
	longitude: z.number().nullable(),
	country: z
		.object({
			id: z.string(),
			object: z.literal("country"),
			name: z.string(),
			iso: z.string(),
		})
		.nullable(),
	url: z.string(),
	account: AccountRef,
	contact: z.lazy(() => EmbeddedContact),
	created_at: z.string(),
	updated_at: z.string(),
});

/** Full contact object returned by GET /api/contacts and GET /api/contacts/:id. */
export const FullContact = z.object({
	id: z.number().int(),
	uuid: z.string(),
	object: z.literal("contact"),
	hash_id: z.string(),
	first_name: z.string(),
	last_name: z.string().nullable(),
	nickname: z.string().nullable(),
	complete_name: z.string(),
	initials: z.string(),
	description: z.string().nullable(),
	gender: z.string(),
	gender_type: z.string(),
	is_starred: z.boolean(),
	is_partial: z.boolean(),
	is_active: z.boolean(),
	is_dead: z.boolean(),
	is_me: z.boolean(),
	last_called: z.string().nullable(),
	last_activity_together: z.string().nullable(),
	stay_in_touch_frequency: z.number().int().nullable(),
	stay_in_touch_trigger_date: z.string().nullable(),
	information: z.object({
		relationships: z.object({
			love: RelationshipGroup,
			family: RelationshipGroup,
			friend: RelationshipGroup,
			work: RelationshipGroup,
		}),
		dates: z.object({
			birthdate: MonicaDateField,
			deceased_date: MonicaDateField,
		}),
		career: z.object({
			job: z.string().nullable(),
			company: z.string().nullable(),
		}),
		avatar: Avatar,
		food_preferences: z.string().nullable(),
		how_you_met: z.object({
			general_information: z.string().nullable(),
			first_met_date: MonicaDateField,
			first_met_through_contact: z.unknown().nullable(),
		}),
	}),
	addresses: z.array(AddressInline),
	tags: z.array(Tag),
	statistics: ContactStatistics,
	// Optional fields only present with ?with=contactfields
	contactFields: z.array(z.unknown()).optional(),
	notes: z.array(z.unknown()).optional(),
	url: z.string(),
	account: AccountRef,
	created_at: z.string(),
	updated_at: z.string(),
});
export type FullContact = z.infer<typeof FullContact>;

/** Request body for POST /api/contacts (create contact). Uses .strict() for request validation. */
export const CreateContactRequest = z
	.object({
		first_name: z.string().max(50),
		last_name: z.string().max(100).optional(),
		nickname: z.string().max(100).optional(),
		gender_id: z.number().int(),
		is_birthdate_known: z.boolean(),
		birthdate_day: z.number().int().optional(),
		birthdate_month: z.number().int().optional(),
		birthdate_year: z.number().int().optional(),
		birthdate_is_age_based: z.boolean().optional(),
		birthdate_age: z.number().int().optional(),
		is_deceased: z.boolean(),
		is_deceased_date_known: z.boolean(),
		deceased_date_day: z.number().int().optional(),
		deceased_date_month: z.number().int().optional(),
		deceased_date_year: z.number().int().optional(),
		deceased_date_is_age_based: z.boolean().optional(),
		is_partial: z.boolean().optional(),
	})
	.strict();
export type CreateContactRequest = z.infer<typeof CreateContactRequest>;

/** Request body for PUT /api/contacts/:id/work. Uses .strict() for request validation. */
export const UpdateContactCareerRequest = z
	.object({
		job: z.string().max(255).optional(),
		company: z.string().max(255).optional(),
	})
	.strict();
export type UpdateContactCareerRequest = z.infer<typeof UpdateContactCareerRequest>;
