import type { InboundEvent } from "@monica-companion/types";
import type { BotContext } from "../context";

export type DownloadFileFn = (fileId: string) => Promise<{ buffer: ArrayBuffer }>;

export type TranscribeFn = (
	metadata: {
		mimeType: string;
		durationSeconds: number;
		correlationId: string;
	},
	audioBuffer: ArrayBuffer,
	userId: string,
) => Promise<{ success: boolean; text?: string; error?: string; correlationId: string }>;

export type ForwardEventFn = (event: InboundEvent) => Promise<void>;

/**
 * Creates a handler for voice messages.
 * Downloads file, transcribes, and forwards to ai-router.
 */
export function createVoiceMessageHandler(
	downloadFile: DownloadFileFn,
	transcribe: TranscribeFn,
	forwardEvent: ForwardEventFn,
) {
	return async (ctx: BotContext): Promise<void> => {
		try {
			await ctx.api.sendChatAction(ctx.chat!.id, "typing");

			const voice = ctx.message!.voice!;
			const { buffer } = await downloadFile(voice.file_id);

			const transcriptionResult = await transcribe(
				{
					mimeType: voice.mime_type ?? "audio/ogg",
					durationSeconds: voice.duration,
					correlationId: ctx.correlationId,
				},
				buffer,
				ctx.userId,
			);

			if (!transcriptionResult.success || !transcriptionResult.text) {
				await ctx.reply(
					"Sorry, I could not transcribe your voice message. Please try again or send text instead.",
				);
				return;
			}

			// Send second typing indicator after transcription completes
			await ctx.api.sendChatAction(ctx.chat!.id, "typing");

			const event: InboundEvent = {
				type: "voice_message",
				userId: ctx.userId,
				sourceRef: `tg:voice:${ctx.message!.message_id}`,
				transcribedText: transcriptionResult.text,
				correlationId: ctx.correlationId,
			};

			await forwardEvent(event);
		} catch {
			await ctx.reply(
				"Sorry, I encountered an error processing your voice message. Please try again.",
			);
		}
	};
}
