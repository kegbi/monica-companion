import { z } from "zod/v4";

export const ConnectorUserLookupResponseSchema = z.object({
	found: z.boolean(),
	userId: z.string().optional(),
});

export type ConnectorUserLookupResponse = z.infer<typeof ConnectorUserLookupResponseSchema>;
