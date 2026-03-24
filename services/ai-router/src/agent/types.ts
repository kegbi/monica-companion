/**
 * Shared types for the agent loop.
 *
 * TODO: The name "GraphResponse" is a vestige of the earlier LangGraph-based
 * pipeline. It can be renamed to "AgentResponse" in a future cleanup pass.
 */

import { z } from "zod/v4";

export const GraphResponseSchema = z.object({
	type: z.enum(["text", "confirmation_prompt", "disambiguation_prompt", "error"]),
	text: z.string().min(1),
	pendingCommandId: z.string().optional(),
	version: z.number().int().positive().optional(),
	options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
});

export type GraphResponse = z.infer<typeof GraphResponseSchema>;
