import { createServiceClient } from "@monica-companion/auth";
import type { TranscriptionRequestMetadata, TranscriptionResponse } from "@monica-companion/types";

export interface VoiceTranscriptionClientOptions {
	baseUrl: string;
	secret: string;
	timeoutMs?: number;
}

export interface VoiceTranscriptionClient {
	transcribe(
		metadata: TranscriptionRequestMetadata,
		audioBuffer: ArrayBuffer,
		userId: string,
	): Promise<TranscriptionResponse>;
}

export function createVoiceTranscriptionClient(
	options: VoiceTranscriptionClientOptions,
): VoiceTranscriptionClient {
	const client = createServiceClient({
		issuer: "telegram-bridge",
		audience: "voice-transcription",
		secret: options.secret,
		baseUrl: options.baseUrl,
	});

	return {
		async transcribe(
			metadata: TranscriptionRequestMetadata,
			audioBuffer: ArrayBuffer,
			userId: string,
		): Promise<TranscriptionResponse> {
			const formData = new FormData();
			formData.append("metadata", JSON.stringify(metadata));
			formData.append("file", new Blob([audioBuffer], { type: metadata.mimeType }), "audio.ogg");

			const signal = AbortSignal.timeout(options.timeoutMs ?? 30_000);
			const res = await client.fetch("/internal/transcribe", {
				method: "POST",
				body: formData,
				correlationId: metadata.correlationId,
				userId,
				signal,
			});

			if (!res.ok) {
				throw new Error(`Transcription request failed with status ${res.status}`);
			}

			return res.json();
		},
	};
}
