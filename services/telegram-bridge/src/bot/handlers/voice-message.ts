import { createLogger } from "@monica-companion/observability";
import type { InboundEvent } from "@monica-companion/types";
import type { BotContext } from "../context";

const logger = createLogger("telegram-bridge:voice-handler");

export type DownloadFileFn = (fileId: string) => Promise<{ buffer: ArrayBuffer }>;

export type TranscribeFn = (
	metadata: {
		mimeType: string;
		durationSeconds: number;
		correlationId: string;
		languageHint?: string;
	},
	audioBuffer: ArrayBuffer,
	userId: string,
) => Promise<{ success: boolean; text?: string; error?: string; correlationId: string }>;

export type ForwardEventFn = (event: InboundEvent) => Promise<void>;

export type GetLanguagePreferenceFn = (userId: string) => Promise<string | undefined>;

/**
 * Creates a handler for voice messages.
 * Downloads file, transcribes, and forwards to ai-router.
 */
export function createVoiceMessageHandler(
	downloadFile: DownloadFileFn,
	transcribe: TranscribeFn,
	forwardEvent: ForwardEventFn,
	getLanguagePreference?: GetLanguagePreferenceFn,
) {
	return async (ctx: BotContext): Promise<void> => {
		try {
			await ctx.api.sendChatAction(ctx.chat!.id, "typing");

			const voice = ctx.message!.voice!;
			const { buffer } = await downloadFile(voice.file_id);

			// Fetch user language preference for transcription hint (best-effort)
			let languageHint: string | undefined;
			if (getLanguagePreference) {
				try {
					languageHint = await getLanguagePreference(ctx.userId);
				} catch (err) {
					logger.warn("Failed to fetch language preference, proceeding without hint", {
						correlationId: ctx.correlationId,
						userId: ctx.userId,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}

			const transcriptionResult = await transcribe(
				{
					mimeType: voice.mime_type ?? "audio/ogg",
					durationSeconds: voice.duration,
					correlationId: ctx.correlationId,
					languageHint,
				},
				buffer,
				ctx.userId,
			);

			if (!transcriptionResult.success || !transcriptionResult.text) {
				logger.warn("Voice transcription failed", {
					correlationId: ctx.correlationId,
					userId: ctx.userId,
					error: transcriptionResult.error,
				});
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
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.error("Failed to process voice message", {
				correlationId: ctx.correlationId,
				userId: ctx.userId,
				error: msg,
			});
			await ctx.reply(
				"Sorry, I encountered an error processing your voice message. Please try again.",
			);
		}
	};
}
