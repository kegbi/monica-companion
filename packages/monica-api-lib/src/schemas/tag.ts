import { z } from "zod/v4";
import { AccountRef } from "./common.js";

/** Tag resource object from Monica API. */
export const Tag = z.object({
	id: z.number().int(),
	object: z.literal("tag"),
	name: z.string(),
	name_slug: z.string(),
	account: AccountRef,
	created_at: z.string(),
	updated_at: z.string(),
});
export type Tag = z.infer<typeof Tag>;
