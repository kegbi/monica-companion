import { z } from "zod/v4";
import { AccountRef } from "./common.js";
import { EmbeddedContact } from "./contact.js";

/** Relationship type object from Monica API. */
export const RelationshipType = z.object({
	id: z.number().int(),
	object: z.literal("relationshiptype"),
	name: z.string(),
	name_reverse_relationship: z.string(),
	relationship_type_group_id: z.number().int(),
	delible: z.boolean(),
	account: AccountRef,
	created_at: z.string(),
	updated_at: z.string(),
});
export type RelationshipType = z.infer<typeof RelationshipType>;

/** Relationship type group object from Monica API. */
export const RelationshipTypeGroup = z.object({
	id: z.number().int(),
	object: z.literal("relationshiptypegroup"),
	name: z.string(),
	delible: z.boolean(),
	account: AccountRef,
	created_at: z.string(),
	updated_at: z.string(),
});
export type RelationshipTypeGroup = z.infer<typeof RelationshipTypeGroup>;

/** Full relationship resource object from Monica API. */
export const Relationship = z.object({
	id: z.number().int(),
	uuid: z.string(),
	object: z.literal("relationship"),
	contact_is: EmbeddedContact,
	relationship_type: RelationshipType,
	of_contact: EmbeddedContact,
	url: z.string(),
	account: AccountRef,
	created_at: z.string(),
	updated_at: z.string(),
});
export type Relationship = z.infer<typeof Relationship>;

/** Request body for POST /api/relationships (create relationship). Uses .strict(). */
export const CreateRelationshipRequest = z
	.object({
		contact_is: z.number().int(),
		of_contact: z.number().int(),
		relationship_type_id: z.number().int(),
	})
	.strict();
export type CreateRelationshipRequest = z.infer<typeof CreateRelationshipRequest>;

/** Request body for PUT /api/relationships/:id (update relationship). Uses .strict(). */
export const UpdateRelationshipRequest = z
	.object({
		relationship_type_id: z.number().int(),
	})
	.strict();
export type UpdateRelationshipRequest = z.infer<typeof UpdateRelationshipRequest>;
