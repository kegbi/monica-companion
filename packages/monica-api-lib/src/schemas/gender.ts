import { z } from "zod/v4";
import { AccountRef } from "./common.js";

/** Gender resource object from Monica API. */
export const Gender = z.object({
	id: z.number().int(),
	object: z.literal("gender"),
	name: z.string(),
	type: z.string(),
	account: AccountRef,
	created_at: z.string(),
	updated_at: z.string(),
});
export type Gender = z.infer<typeof Gender>;
