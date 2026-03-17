import { describe, expect, it } from "vitest";
import {
	TranscriptionRequestMetadataSchema,
	TranscriptionResponseSchema,
} from "../transcription.js";

describe("TranscriptionRequestMetadataSchema", () => {
	it("parses valid metadata", () => {
		const result = TranscriptionRequestMetadataSchema.safeParse({
			mimeType: "audio/ogg",
			durationSeconds: 5,
			correlationId: "corr-123",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.mimeType).toBe("audio/ogg");
			expect(result.data.durationSeconds).toBe(5);
			expect(result.data.languageHint).toBeUndefined();
		}
	});

	it("parses metadata with optional languageHint", () => {
		const result = TranscriptionRequestMetadataSchema.safeParse({
			mimeType: "audio/ogg",
			durationSeconds: 10,
			languageHint: "en",
			correlationId: "corr-456",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.languageHint).toBe("en");
		}
	});

	it("parses metadata with optional fetchUrl", () => {
		const result = TranscriptionRequestMetadataSchema.safeParse({
			mimeType: "audio/ogg",
			durationSeconds: 5,
			correlationId: "corr-789",
			fetchUrl: "https://example.com/audio.ogg",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.fetchUrl).toBe("https://example.com/audio.ogg");
		}
	});

	it("parses metadata with optional fileSizeBytes", () => {
		const result = TranscriptionRequestMetadataSchema.safeParse({
			mimeType: "audio/ogg",
			durationSeconds: 5,
			correlationId: "corr-size",
			fileSizeBytes: 102400,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.fileSizeBytes).toBe(102400);
		}
	});

	it("rejects invalid fetchUrl", () => {
		const result = TranscriptionRequestMetadataSchema.safeParse({
			mimeType: "audio/ogg",
			durationSeconds: 5,
			correlationId: "corr-bad-url",
			fetchUrl: "not-a-url",
		});
		expect(result.success).toBe(false);
	});

	it("rejects non-positive fileSizeBytes", () => {
		const result = TranscriptionRequestMetadataSchema.safeParse({
			mimeType: "audio/ogg",
			durationSeconds: 5,
			correlationId: "corr-bad-size",
			fileSizeBytes: 0,
		});
		expect(result.success).toBe(false);
	});

	it("rejects non-integer fileSizeBytes", () => {
		const result = TranscriptionRequestMetadataSchema.safeParse({
			mimeType: "audio/ogg",
			durationSeconds: 5,
			correlationId: "corr-float-size",
			fileSizeBytes: 1024.5,
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing mimeType", () => {
		const result = TranscriptionRequestMetadataSchema.safeParse({
			durationSeconds: 5,
			correlationId: "corr-123",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing correlationId", () => {
		const result = TranscriptionRequestMetadataSchema.safeParse({
			mimeType: "audio/ogg",
			durationSeconds: 5,
		});
		expect(result.success).toBe(false);
	});
});

describe("TranscriptionResponseSchema", () => {
	it("parses a successful response", () => {
		const result = TranscriptionResponseSchema.safeParse({
			success: true,
			text: "Hello, world!",
			correlationId: "corr-123",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.text).toBe("Hello, world!");
		}
	});

	it("parses a successful response with detectedLanguage", () => {
		const result = TranscriptionResponseSchema.safeParse({
			success: true,
			text: "Hello, world!",
			correlationId: "corr-lang",
			detectedLanguage: "en",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.detectedLanguage).toBe("en");
		}
	});

	it("parses an error response", () => {
		const result = TranscriptionResponseSchema.safeParse({
			success: false,
			error: "Transcription failed",
			correlationId: "corr-456",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.error).toBe("Transcription failed");
		}
	});

	it("allows detectedLanguage to be omitted", () => {
		const result = TranscriptionResponseSchema.safeParse({
			success: true,
			text: "test",
			correlationId: "corr-no-lang",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.detectedLanguage).toBeUndefined();
		}
	});

	it("rejects missing success field", () => {
		const result = TranscriptionResponseSchema.safeParse({
			text: "hello",
			correlationId: "corr-123",
		});
		expect(result.success).toBe(false);
	});
});
