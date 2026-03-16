import { z } from "zod/v4";
import { AccountRef } from "./common.js";
import { EmbeddedContact } from "./contact.js";

/** Note resource object from Monica API. */
export const Note = z.object({
	id: z.number().int(),
	uuid: z.string(),
	object: z.literal("note"),
	body: z.string(),
	is_favorited: z.boolean(),
	favorited_at: z.string().nullable(),
	url: z.string(),
	account: AccountRef,
	contact: EmbeddedContact,
	created_at: z.string(),
	updated_at: z.string(),
});
export type Note = z.infer<typeof Note>;

/** Request body for POST /api/notes (create note). Uses .strict() for request validation. */
export const CreateNoteRequest = z
	.object({
		body: z.string().max(100000),
		contact_id: z.number().int(),
		is_favorited: z.boolean().optional(),
	})
	.strict();
export type CreateNoteRequest = z.infer<typeof CreateNoteRequest>;
