import { trace } from "@opentelemetry/api";
import OpenAI from "openai";

const tracer = trace.getTracer("voice-transcription");

export type TranscriptionErrorCategory =
	| "timeout"
	| "rate_limit"
	| "server_error"
	| "invalid_audio"
	| "unknown";

const USER_MESSAGES: Record<TranscriptionErrorCategory, string> = {
	timeout: "Transcription timed out. Please try again with a shorter voice message.",
	rate_limit: "Too many transcription requests. Please wait a moment and try again.",
	server_error: "The transcription service is temporarily unavailable. Please try again shortly.",
	invalid_audio:
		"The audio format is not supported. Please send a voice message in a supported format.",
	unknown: "An unexpected error occurred during transcription. Please try again.",
};

export class TranscriptionError extends Error {
	readonly category: TranscriptionErrorCategory;
	readonly userMessage: string;

	constructor(category: TranscriptionErrorCategory, cause?: unknown) {
		super(USER_MESSAGES[category]);
		this.name = "TranscriptionError";
		this.category = category;
		this.userMessage = USER_MESSAGES[category];
		this.cause = cause;
	}
}

export interface WhisperClientOptions {
	apiKey: string;
	model: string;
	timeoutMs: number;
}

export interface TranscriptionResult {
	text: string;
	detectedLanguage?: string;
}

export interface WhisperClient {
	transcribe(
		audioBlob: Blob,
		filename: string,
		languageHint?: string,
	): Promise<TranscriptionResult>;
}

function classifyError(error: unknown): TranscriptionErrorCategory {
	if (error instanceof DOMException && error.name === "AbortError") {
		return "timeout";
	}

	if (error instanceof Error && error.name === "AbortError") {
		return "timeout";
	}

	const errorWithStatus = error as { status?: unknown } | null | undefined;
	const status = errorWithStatus?.status;
	if (typeof status === "number") {
		if (status === 429) return "rate_limit";
		if (status === 400) return "invalid_audio";
		if (status >= 500) return "server_error";
	}

	return "unknown";
}

function isRetryable(category: TranscriptionErrorCategory): boolean {
	return category === "server_error";
}

const RETRY_DELAY_MS = 1000;

export function createWhisperClient(options: WhisperClientOptions): WhisperClient {
	const openai = new OpenAI({ apiKey: options.apiKey });

	async function attemptTranscription(
		audioBlob: Blob,
		filename: string,
		languageHint?: string,
	): Promise<TranscriptionResult> {
		const file = new File([audioBlob], filename, { type: audioBlob.type });

		const params: OpenAI.Audio.TranscriptionCreateParams & {
			response_format: "verbose_json";
		} = {
			file,
			model: options.model,
			response_format: "verbose_json",
		};

		if (languageHint) {
			params.language = languageHint;
		}

		const response = await openai.audio.transcriptions.create(params, {
			signal: AbortSignal.timeout(options.timeoutMs),
		});

		return {
			text: response.text,
			detectedLanguage: response.language,
		};
	}

	return {
		async transcribe(
			audioBlob: Blob,
			filename: string,
			languageHint?: string,
		): Promise<TranscriptionResult> {
			return tracer.startActiveSpan("voice-transcription.whisper_call", async (span) => {
				try {
					span.setAttribute("whisper.model", options.model);
					if (languageHint) {
						span.setAttribute("whisper.language_hint", languageHint);
					}

					const result = await attemptTranscription(audioBlob, filename, languageHint);

					span.setAttribute("whisper.success", true);
					if (result.detectedLanguage) {
						span.setAttribute("whisper.detected_language", result.detectedLanguage);
					}
					span.end();
					return result;
				} catch (firstError) {
					const category = classifyError(firstError);

					if (isRetryable(category)) {
						span.setAttribute("whisper.retry", true);
						await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

						try {
							const result = await attemptTranscription(audioBlob, filename, languageHint);
							span.setAttribute("whisper.success", true);
							span.setAttribute("whisper.retried", true);
							if (result.detectedLanguage) {
								span.setAttribute("whisper.detected_language", result.detectedLanguage);
							}
							span.end();
							return result;
						} catch (retryError) {
							const retryCategory = classifyError(retryError);
							span.setAttribute("whisper.success", false);
							span.setAttribute("whisper.error_category", retryCategory);
							span.end();
							throw new TranscriptionError(retryCategory, retryError);
						}
					}

					span.setAttribute("whisper.success", false);
					span.setAttribute("whisper.error_category", category);
					span.end();
					throw new TranscriptionError(category, firstError);
				}
			});
		},
	};
}
