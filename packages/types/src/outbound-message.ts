import { z } from "zod/v4";

const TextContent = z.object({
	type: z.literal("text"),
	text: z.string().min(1),
});

const ConfirmationPromptContent = z.object({
	type: z.literal("confirmation_prompt"),
	text: z.string().min(1),
	pendingCommandId: z.string().min(1),
	version: z.number().int().positive(),
});

const DisambiguationPromptContent = z.object({
	type: z.literal("disambiguation_prompt"),
	text: z.string().min(1),
	options: z
		.array(
			z.object({
				label: z.string().min(1),
				value: z.string().min(1),
			}),
		)
		.min(1),
});

const ErrorContent = z.object({
	type: z.literal("error"),
	text: z.string().min(1),
});

export const OutboundContentSchema = z.discriminatedUnion("type", [
	TextContent,
	ConfirmationPromptContent,
	DisambiguationPromptContent,
	ErrorContent,
]);

export type OutboundContent = z.infer<typeof OutboundContentSchema>;

export const OutboundMessageIntentSchema = z.object({
	userId: z.string().min(1),
	connectorType: z.enum(["telegram"]),
	connectorRoutingId: z.string().min(1),
	correlationId: z.string().min(1),
	content: OutboundContentSchema,
});

export type OutboundMessageIntent = z.infer<typeof OutboundMessageIntentSchema>;
