import { createLogger } from "@monica-companion/observability";
import { TranscriptionRequestMetadataSchema } from "@monica-companion/types";
import { trace } from "@opentelemetry/api";
import type { Context } from "hono";
import { AudioFetchError, fetchAudio } from "./audio-fetcher";
import type { Config } from "./config";
import { TranscriptionError, type WhisperClient } from "./whisper-client";

const logger = createLogger("voice-transcription");
const tracer = trace.getTracer("voice-transcription");

export interface TranscriptionHandlerDeps {
	config: Config;
	whisperClient: WhisperClient;
}

export function createTranscriptionHandler(deps: TranscriptionHandlerDeps) {
	const { config, whisperClient } = deps;

	return async (c: Context) => {
		return tracer.startActiveSpan("voice-transcription.transcribe", async (span) => {
			let correlationId = "unknown";

			try {
				// Parse multipart form data
				let formData: FormData;
				try {
					formData = await c.req.formData();
				} catch {
					span.end();
					return c.json({ error: "Invalid multipart request" }, 400);
				}

				// Parse and validate metadata
				const metadataRaw = formData.get("metadata");
				if (typeof metadataRaw !== "string") {
					span.end();
					return c.json({ error: "Missing metadata field" }, 400);
				}

				let metadataParsed: unknown;
				try {
					metadataParsed = JSON.parse(metadataRaw);
				} catch {
					span.end();
					return c.json({ error: "Invalid metadata JSON" }, 400);
				}

				const metadataResult = TranscriptionRequestMetadataSchema.safeParse(metadataParsed);
				if (!metadataResult.success) {
					span.end();
					return c.json({ error: "Invalid metadata" }, 400);
				}

				const metadata = metadataResult.data;
				correlationId = metadata.correlationId;

				span.setAttribute("transcription.correlation_id", correlationId);
				span.setAttribute("transcription.mime_type", metadata.mimeType);
				span.setAttribute("transcription.duration_seconds", metadata.durationSeconds);
				span.setAttribute(
					"transcription.input_mode",
					metadata.fetchUrl ? "fetch_url" : "binary_upload",
				);

				logger.info("Transcription request received", {
					correlationId,
					mimeType: metadata.mimeType,
					durationSeconds: metadata.durationSeconds,
					inputMode: metadata.fetchUrl ? "fetch_url" : "binary_upload",
				});

				// Determine input mode and get audio data
				let audioBlob: Blob;
				let filename: string;

				if (metadata.fetchUrl) {
					// Fetch-URL mode
					try {
						const fetchResult = await fetchAudio(metadata.fetchUrl, {
							timeoutMs: config.fetchUrlTimeoutMs,
							maxSizeBytes: config.whisperMaxFileSizeBytes,
						});

						audioBlob = new Blob([fetchResult.buffer], {
							type: fetchResult.contentType,
						});
						filename = "audio_fetched";
					} catch (e) {
						if (e instanceof AudioFetchError) {
							logger.warn("Audio fetch failed", {
								correlationId,
								category: e.category,
							});
							span.setAttribute("transcription.error_category", e.category);
							span.end();
							return c.json(
								{
									success: false,
									error: e.userMessage,
									correlationId,
								},
								200,
							);
						}
						throw e;
					}
				} else {
					// Binary upload mode
					const file = formData.get("file");
					if (!file || !(file instanceof Blob)) {
						span.end();
						return c.json(
							{
								success: false,
								error: "No audio input provided. Supply either a file upload or a fetchUrl.",
								correlationId,
							},
							400,
						);
					}

					audioBlob = file;
					filename = file instanceof File && file.name ? file.name : "audio_upload.ogg";
				}

				// Validate audio size
				if (audioBlob.size > config.whisperMaxFileSizeBytes) {
					logger.warn("Audio file too large", {
						correlationId,
						size: audioBlob.size,
						maxSize: config.whisperMaxFileSizeBytes,
					});
					span.setAttribute("transcription.rejected", "file_too_large");
					span.end();
					return c.json(
						{
							success: false,
							error: "The audio file is too large to process.",
							correlationId,
						},
						400,
					);
				}

				// Call Whisper API
				try {
					const result = await whisperClient.transcribe(audioBlob, filename, metadata.languageHint);

					logger.info("Transcription succeeded", {
						correlationId,
						detectedLanguage: result.detectedLanguage,
						textLength: result.text.length,
					});

					span.setAttribute("transcription.success", true);
					if (result.detectedLanguage) {
						span.setAttribute("transcription.detected_language", result.detectedLanguage);
					}
					span.end();

					return c.json({
						success: true,
						text: result.text,
						detectedLanguage: result.detectedLanguage,
						correlationId,
					});
				} catch (e) {
					if (e instanceof TranscriptionError) {
						logger.warn("Transcription failed", {
							correlationId,
							category: e.category,
						});
						span.setAttribute("transcription.success", false);
						span.setAttribute("transcription.error_category", e.category);
						span.end();

						return c.json({
							success: false,
							error: e.userMessage,
							correlationId,
						});
					}
					throw e;
				}
			} catch (e) {
				logger.error("Unexpected transcription error", {
					correlationId,
					error: e instanceof Error ? e.message : String(e),
				});
				span.setAttribute("transcription.success", false);
				span.setAttribute("transcription.error_category", "unexpected");
				span.end();

				return c.json({
					success: false,
					error: "An unexpected error occurred during transcription. Please try again.",
					correlationId,
				});
			}
		});
	};
}
