import { z } from "zod/v4";

const InboundEventBase = z.object({
	userId: z.uuid(),
	sourceRef: z.string().min(1),
	correlationId: z.string().min(1),
});

const TextMessageEvent = InboundEventBase.extend({
	type: z.literal("text_message"),
	text: z.string().min(1),
});

const VoiceMessageEvent = InboundEventBase.extend({
	type: z.literal("voice_message"),
	transcribedText: z.string().min(1),
});

const CallbackActionEvent = InboundEventBase.extend({
	type: z.literal("callback_action"),
	action: z.string().min(1),
	data: z.string(),
});

export const InboundEventSchema = z.discriminatedUnion("type", [
	TextMessageEvent,
	VoiceMessageEvent,
	CallbackActionEvent,
]);

export type InboundEvent = z.infer<typeof InboundEventSchema>;
