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

	it("rejects missing success field", () => {
		const result = TranscriptionResponseSchema.safeParse({
			text: "hello",
			correlationId: "corr-123",
		});
		expect(result.success).toBe(false);
	});
});
