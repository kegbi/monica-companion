import { z } from "zod/v4";
import { AccountRef } from "./common.js";
import { EmbeddedContact } from "./contact.js";

/** Country object embedded in addresses. */
export const Country = z.object({
	id: z.string(),
	object: z.literal("country"),
	name: z.string(),
	iso: z.string(),
});
export type Country = z.infer<typeof Country>;

/** Address resource object from Monica API. */
export const Address = z.object({
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
	country: Country.nullable(),
	url: z.string(),
	account: AccountRef,
	contact: EmbeddedContact,
	created_at: z.string(),
	updated_at: z.string(),
});
export type Address = z.infer<typeof Address>;

/** Request body for POST /api/addresses (create address). Uses .strict(). */
export const CreateAddressRequest = z
	.object({
		name: z.string().optional(),
		street: z.string().nullable().optional(),
		city: z.string().nullable().optional(),
		province: z.string().nullable().optional(),
		postal_code: z.string().nullable().optional(),
		country: z.string(),
		contact_id: z.number().int(),
	})
	.strict();
export type CreateAddressRequest = z.infer<typeof CreateAddressRequest>;
