import { z } from "zod/v4";
import { AccountRef } from "./common.js";
import { EmbeddedContact } from "./contact.js";

/** Contact field type object (email, phone, etc.). */
export const ContactFieldType = z.object({
	id: z.number().int(),
	uuid: z.string(),
	object: z.literal("contactfieldtype"),
	name: z.string(),
	fontawesome_icon: z.string(),
	protocol: z.string().nullable(),
	delible: z.boolean(),
	type: z.string().nullable(),
	account: AccountRef,
	created_at: z.string(),
	updated_at: z.string(),
});
export type ContactFieldType = z.infer<typeof ContactFieldType>;

/** Contact field resource object from Monica API. Note: response uses "content", not "data". */
export const ContactField = z.object({
	id: z.number().int(),
	uuid: z.string(),
	object: z.literal("contactfield"),
	content: z.string(),
	contact_field_type: ContactFieldType,
	labels: z.array(z.unknown()),
	account: AccountRef,
	contact: EmbeddedContact,
	created_at: z.string(),
	updated_at: z.string(),
});
export type ContactField = z.infer<typeof ContactField>;

/** Request body for POST /api/contactfields (create contact field). Uses .strict(). */
export const CreateContactFieldRequest = z
	.object({
		data: z.string().max(255),
		contact_field_type_id: z.number().int(),
		contact_id: z.number().int(),
		labels: z.array(z.string()).optional(),
	})
	.strict();
export type CreateContactFieldRequest = z.infer<typeof CreateContactFieldRequest>;
