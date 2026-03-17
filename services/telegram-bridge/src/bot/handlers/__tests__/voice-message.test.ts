import { describe, expect, it, vi } from "vitest";
import { createVoiceMessageHandler } from "../voice-message";

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
	it("downloads file, transcribes, and forwards to ai-router", async () => {
		const mockDownload = vi.fn(async () => ({
			buffer: new ArrayBuffer(10),
		}));
		const mockTranscribe = vi.fn(async () => ({
			success: true,
			text: "Hello from voice",
			correlationId: "corr-voice",
		}));
		const mockForward = vi.fn(async () => {});

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
		const mockForward = vi.fn(async () => {});

		const handler = createVoiceMessageHandler(mockDownload, mockTranscribe, mockForward);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(ctx.reply).toHaveBeenCalledWith(
			"Sorry, I could not transcribe your voice message. Please try again or send text instead.",
		);
		expect(mockForward).not.toHaveBeenCalled();
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
		const mockForward = vi.fn(async () => {});

		const handler = createVoiceMessageHandler(mockDownload, mockTranscribe, mockForward);
		const ctx = createMockCtx();

		await handler(ctx as never);

		expect(ctx.reply).toHaveBeenCalledWith(
			"Sorry, I encountered an error processing your voice message. Please try again.",
		);
	});
});
