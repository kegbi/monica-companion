import { describe, expect, it, vi } from "vitest";
import type { AiRouterResponse } from "../../../lib/ai-router-client.js";
import { createVoiceMessageHandler } from "../voice-message.js";

const TEXT_RESPONSE: AiRouterResponse = { type: "text", text: "Got it, noted." };

function createMockCtx() {
	return {
		userId: "user-uuid-123",
		correlationId: "corr-voice",
		telegramUserId: 12345,
		message: {
			message_id: 55,
			voice: {
				file_id: "voice-file-id",
				duration: 5,
				mime_type: "audio/ogg",
			},
		},
		chat: { id: 12345 },
		api: {
			sendChatAction: vi.fn(async () => true),
		},
		reply: vi.fn(async () => ({})),
	};
}

describe("voiceMessageHandler", () => {
	it("downloads file, transcribes, forwards to ai-router, and replies", async () => {
		const mockDownload = vi.fn(async () => ({
			buffer: new ArrayBuffer(10),
		}));
		const mockTranscribe = vi.fn(async () => ({
			success: true,
			text: "Hello from voice",
			correlationId: "corr-voice",
		}));
		const mockForward = vi.fn(async () => TEXT_RESPONSE);

		const handler = createVoiceMessageHandler(mockDownload, mockTranscribe, mockForward);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(ctx.api.sendChatAction).toHaveBeenCalledWith(12345, "typing");
		expect(mockDownload).toHaveBeenCalledWith("voice-file-id");
		expect(mockTranscribe).toHaveBeenCalled();
		expect(mockForward).toHaveBeenCalledWith({
			type: "voice_message",
			userId: "user-uuid-123",
			sourceRef: "tg:voice:55",
			transcribedText: "Hello from voice",
			correlationId: "corr-voice",
		});
		expect(ctx.reply).toHaveBeenCalledWith("Got it, noted.", { parse_mode: "Markdown" });
	});

	it("passes userId to transcribe function for guardrail enforcement", async () => {
		const mockDownload = vi.fn(async () => ({
			buffer: new ArrayBuffer(10),
		}));
		const mockTranscribe = vi.fn(async () => ({
			success: true,
			text: "Hello from voice",
			correlationId: "corr-voice",
		}));
		const mockForward = vi.fn(async () => TEXT_RESPONSE);

		const handler = createVoiceMessageHandler(mockDownload, mockTranscribe, mockForward);
		const ctx = createMockCtx();

		await handler(ctx as never);

		// Verify userId is passed as the third argument to transcribe
		expect(mockTranscribe).toHaveBeenCalledWith(
			expect.objectContaining({
				mimeType: "audio/ogg",
				durationSeconds: 5,
				correlationId: "corr-voice",
			}),
			expect.any(ArrayBuffer),
			"user-uuid-123",
		);
	});

	it("sends error message when transcription fails", async () => {
		const mockDownload = vi.fn(async () => ({
			buffer: new ArrayBuffer(10),
		}));
		const mockTranscribe = vi.fn(async () => ({
			success: false,
			error: "Transcription failed",
			correlationId: "corr-voice",
		}));
		const mockForward = vi.fn(async () => TEXT_RESPONSE);

		const handler = createVoiceMessageHandler(mockDownload, mockTranscribe, mockForward);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(ctx.reply).toHaveBeenCalledWith(
			"Sorry, I could not transcribe your voice message. Please try again or send text instead.",
		);
		expect(mockForward).not.toHaveBeenCalled();
	});

	it("renders error responses from ai-router", async () => {
		const errorResponse: AiRouterResponse = {
			type: "error",
			text: "Sorry, I encountered an error processing your request. Please try again.",
		};
		const mockDownload = vi.fn(async () => ({
			buffer: new ArrayBuffer(10),
		}));
		const mockTranscribe = vi.fn(async () => ({
			success: true,
			text: "Hello",
			correlationId: "corr-voice",
		}));
		const mockForward = vi.fn(async () => errorResponse);

		const handler = createVoiceMessageHandler(mockDownload, mockTranscribe, mockForward);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(ctx.reply).toHaveBeenCalledWith(errorResponse.text);
	});

	it("passes user language preference as languageHint in transcription metadata", async () => {
		const mockDownload = vi.fn(async () => ({
			buffer: new ArrayBuffer(10),
		}));
		const mockTranscribe = vi.fn(async () => ({
			success: true,
			text: "Elena",
			correlationId: "corr-voice",
		}));
		const mockForward = vi.fn(async () => TEXT_RESPONSE);
		const mockGetLanguagePreference = vi.fn(async () => "en");

		const handler = createVoiceMessageHandler(
			mockDownload,
			mockTranscribe,
			mockForward,
			mockGetLanguagePreference,
		);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(mockGetLanguagePreference).toHaveBeenCalledWith("user-uuid-123");
		expect(mockTranscribe).toHaveBeenCalledWith(
			expect.objectContaining({
				languageHint: "en",
				correlationId: "corr-voice",
			}),
			expect.any(ArrayBuffer),
			"user-uuid-123",
		);
	});

	it("omits languageHint when getLanguagePreference is not provided", async () => {
		const mockDownload = vi.fn(async () => ({
			buffer: new ArrayBuffer(10),
		}));
		const mockTranscribe = vi.fn(async () => ({
			success: true,
			text: "Hello",
			correlationId: "corr-voice",
		}));
		const mockForward = vi.fn(async () => TEXT_RESPONSE);

		const handler = createVoiceMessageHandler(mockDownload, mockTranscribe, mockForward);
		const ctx = createMockCtx();

		await handler(ctx as never);

		// Without the dep, languageHint should be undefined
		const metadata = mockTranscribe.mock.calls[0][0];
		expect(metadata.languageHint).toBeUndefined();
	});

	it("sends error message when download fails", async () => {
		const mockDownload = vi.fn(async () => {
			throw new Error("Download failed");
		});
		const mockTranscribe = vi.fn(async () => ({
			success: true,
			text: "test",
			correlationId: "corr",
		}));
		const mockForward = vi.fn(async () => TEXT_RESPONSE);

		const handler = createVoiceMessageHandler(mockDownload, mockTranscribe, mockForward);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(ctx.reply).toHaveBeenCalledWith(
			"Sorry, I encountered an error processing your voice message. Please try again.",
		);
	});
});
