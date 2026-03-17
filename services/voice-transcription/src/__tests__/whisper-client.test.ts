import { afterEach, describe, expect, it, vi } from "vitest";
import { createWhisperClient, TranscriptionError, type WhisperClient } from "../whisper-client";

// Mock the openai module
const mockCreate = vi.fn();
vi.mock("openai", () => {
	return {
		default: class OpenAI {
			audio = {
				transcriptions: {
					create: mockCreate,
				},
			};
		},
	};
});

function makeClient(overrides?: { model?: string; timeoutMs?: number }): WhisperClient {
	return createWhisperClient({
		apiKey: "sk-test-key",
		model: overrides?.model ?? "whisper-1",
		timeoutMs: overrides?.timeoutMs ?? 60000,
	});
}

describe("WhisperClient", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("returns transcript text and detected language on success", async () => {
		mockCreate.mockResolvedValueOnce({
			text: "Hello world",
			language: "en",
		});

		const client = makeClient();
		const result = await client.transcribe(
			new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
			"audio.ogg",
		);

		expect(result.text).toBe("Hello world");
		expect(result.detectedLanguage).toBe("en");
		expect(mockCreate).toHaveBeenCalledTimes(1);
	});

	it("passes language hint to the API when provided", async () => {
		mockCreate.mockResolvedValueOnce({
			text: "Bonjour",
			language: "fr",
		});

		const client = makeClient();
		await client.transcribe(
			new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
			"audio.ogg",
			"fr",
		);

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				language: "fr",
			}),
			expect.anything(),
		);
	});

	it("throws TranscriptionError with category timeout on AbortError", async () => {
		mockCreate.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));

		const client = makeClient();
		try {
			await client.transcribe(
				new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
				"audio.ogg",
			);
			expect.unreachable("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(TranscriptionError);
			expect((e as TranscriptionError).category).toBe("timeout");
		}
	});

	it("throws TranscriptionError with category rate_limit on 429 error", async () => {
		const error = new Error("Rate limit exceeded");
		(error as any).status = 429;
		mockCreate.mockRejectedValueOnce(error);

		const client = makeClient();
		try {
			await client.transcribe(
				new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
				"audio.ogg",
			);
		} catch (e) {
			expect(e).toBeInstanceOf(TranscriptionError);
			expect((e as TranscriptionError).category).toBe("rate_limit");
		}
	});

	it("retries once on 500 server error then succeeds", async () => {
		const serverError = new Error("Internal Server Error");
		(serverError as any).status = 500;

		mockCreate
			.mockRejectedValueOnce(serverError)
			.mockResolvedValueOnce({ text: "Retry success", language: "en" });

		const client = makeClient();
		const result = await client.transcribe(
			new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
			"audio.ogg",
		);

		expect(result.text).toBe("Retry success");
		expect(mockCreate).toHaveBeenCalledTimes(2);
	});

	it("throws TranscriptionError with category server_error after retry exhaustion on 500", async () => {
		const serverError = new Error("Internal Server Error");
		(serverError as any).status = 500;

		mockCreate.mockRejectedValue(serverError);

		const client = makeClient();
		try {
			await client.transcribe(
				new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
				"audio.ogg",
			);
		} catch (e) {
			expect(e).toBeInstanceOf(TranscriptionError);
			expect((e as TranscriptionError).category).toBe("server_error");
		}

		// 1 initial + 1 retry = 2 attempts
		expect(mockCreate).toHaveBeenCalledTimes(2);
	});

	it("throws TranscriptionError with category invalid_audio on 400 error", async () => {
		const badRequestError = new Error("Invalid file format");
		(badRequestError as any).status = 400;
		mockCreate.mockRejectedValueOnce(badRequestError);

		const client = makeClient();
		try {
			await client.transcribe(
				new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
				"audio.ogg",
			);
		} catch (e) {
			expect(e).toBeInstanceOf(TranscriptionError);
			expect((e as TranscriptionError).category).toBe("invalid_audio");
		}
	});

	it("provides user-safe messages for each error category", async () => {
		const error = new Error("Rate limited");
		(error as any).status = 429;
		mockCreate.mockRejectedValueOnce(error);

		const client = makeClient();
		try {
			await client.transcribe(
				new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }),
				"audio.ogg",
			);
		} catch (e) {
			expect((e as TranscriptionError).userMessage).toBeDefined();
			expect((e as TranscriptionError).userMessage.length).toBeGreaterThan(0);
		}
	});
});
