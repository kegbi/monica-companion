import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("voice-transcription");

export type AudioFetchErrorCategory =
	| "timeout"
	| "download_failed"
	| "file_too_large"
	| "blocked_host";

const USER_MESSAGES: Record<AudioFetchErrorCategory, string> = {
	timeout: "Audio download timed out. Please try again.",
	download_failed: "Failed to download the audio file. The link may have expired.",
	file_too_large: "The audio file is too large to process.",
	blocked_host: "The audio URL points to a blocked network address.",
};

export class AudioFetchError extends Error {
	readonly category: AudioFetchErrorCategory;
	readonly userMessage: string;

	constructor(category: AudioFetchErrorCategory, cause?: unknown) {
		super(USER_MESSAGES[category]);
		this.name = "AudioFetchError";
		this.category = category;
		this.userMessage = USER_MESSAGES[category];
		this.cause = cause;
	}
}

export interface AudioFetchOptions {
	timeoutMs: number;
	maxSizeBytes: number;
}

export interface AudioFetchResult {
	buffer: ArrayBuffer;
	contentType: string;
}

/**
 * Patterns matching loopback, RFC1918 private, and link-local addresses.
 * Per M3 finding: validate hostname is not a blocked address.
 */
const BLOCKED_HOST_PATTERNS = [
	/^127\./,
	/^10\./,
	/^172\.(1[6-9]|2\d|3[0-1])\./,
	/^192\.168\./,
	/^169\.254\./,
	/^0\./,
	/^\[?::1\]?$/,
	/^\[?fe80:/i,
	/^\[?fc00:/i,
	/^\[?fd/i,
	/^localhost$/i,
];

function isBlockedHost(hostname: string): boolean {
	return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

/**
 * Fetch audio from a short-lived URL.
 *
 * Security measures (per M3 finding):
 * - Uses `redirect: "error"` to prevent automatic redirect following
 * - Validates hostname against blocked network patterns (loopback, RFC1918, link-local)
 * - Enforces Content-Length and body size limits
 */
export async function fetchAudio(
	url: string,
	options: AudioFetchOptions,
): Promise<AudioFetchResult> {
	return tracer.startActiveSpan("voice-transcription.fetch_audio", async (span) => {
		try {
			// Validate hostname before making the request
			const parsed = new URL(url);
			if (isBlockedHost(parsed.hostname)) {
				span.setAttribute("fetch.blocked", true);
				span.end();
				throw new AudioFetchError("blocked_host");
			}

			const response = await fetch(url, {
				redirect: "error",
				signal: AbortSignal.timeout(options.timeoutMs),
			});

			if (!response.ok) {
				span.setAttribute("fetch.status", response.status);
				span.end();
				throw new AudioFetchError("download_failed");
			}

			// Check content-length header before reading body
			const contentLength = response.headers.get("content-length");
			if (contentLength) {
				const size = Number.parseInt(contentLength, 10);
				if (size > options.maxSizeBytes) {
					span.setAttribute("fetch.content_length_exceeded", true);
					span.end();
					throw new AudioFetchError("file_too_large");
				}
			}

			// Read body and validate actual size
			const buffer = await response.arrayBuffer();
			if (buffer.byteLength > options.maxSizeBytes) {
				span.setAttribute("fetch.body_size_exceeded", true);
				span.end();
				throw new AudioFetchError("file_too_large");
			}

			const contentType = response.headers.get("content-type") ?? "application/octet-stream";

			span.setAttribute("fetch.size_bytes", buffer.byteLength);
			span.setAttribute("fetch.content_type", contentType);
			span.end();

			return { buffer, contentType };
		} catch (e) {
			if (e instanceof AudioFetchError) {
				throw e;
			}
			if (e instanceof DOMException && e.name === "AbortError") {
				span.end();
				throw new AudioFetchError("timeout", e);
			}
			span.end();
			throw new AudioFetchError("download_failed", e);
		}
	});
}
