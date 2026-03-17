import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioFetchError, fetchAudio } from "../audio-fetcher";

const originalFetch = globalThis.fetch;

describe("fetchAudio", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("downloads audio successfully and returns buffer with content type", async () => {
		const audioData = new Uint8Array([1, 2, 3, 4, 5]);
		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response(audioData, {
				status: 200,
				headers: {
					"content-type": "audio/ogg",
					"content-length": "5",
				},
			}),
		);

		const result = await fetchAudio("https://example.com/audio.ogg", {
			timeoutMs: 15000,
			maxSizeBytes: 1024 * 1024,
		});

		expect(result.buffer.byteLength).toBe(5);
		expect(result.contentType).toBe("audio/ogg");
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://example.com/audio.ogg",
			expect.objectContaining({
				redirect: "error",
			}),
		);
	});

	it("rejects non-2xx responses", async () => {
		globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

		await expect(
			fetchAudio("https://example.com/missing.ogg", {
				timeoutMs: 15000,
				maxSizeBytes: 1024 * 1024,
			}),
		).rejects.toThrow(AudioFetchError);

		try {
			globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response("Error", { status: 500 }));
			await fetchAudio("https://example.com/error.ogg", {
				timeoutMs: 15000,
				maxSizeBytes: 1024 * 1024,
			});
		} catch (e) {
			expect(e).toBeInstanceOf(AudioFetchError);
			expect((e as AudioFetchError).category).toBe("download_failed");
		}
	});

	it("rejects when content-length exceeds maxSizeBytes", async () => {
		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response("large content", {
				status: 200,
				headers: {
					"content-type": "audio/ogg",
					"content-length": "99999999",
				},
			}),
		);

		try {
			await fetchAudio("https://example.com/huge.ogg", {
				timeoutMs: 15000,
				maxSizeBytes: 1024,
			});
			expect.unreachable("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(AudioFetchError);
			expect((e as AudioFetchError).category).toBe("file_too_large");
		}
	});

	it("rejects when downloaded body exceeds maxSizeBytes (no content-length header)", async () => {
		const bigData = new Uint8Array(2048);
		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response(bigData, {
				status: 200,
				headers: { "content-type": "audio/ogg" },
			}),
		);

		try {
			await fetchAudio("https://example.com/big.ogg", {
				timeoutMs: 15000,
				maxSizeBytes: 1024,
			});
			expect.unreachable("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(AudioFetchError);
			expect((e as AudioFetchError).category).toBe("file_too_large");
		}
	});

	it("rejects loopback URLs", async () => {
		try {
			await fetchAudio("https://127.0.0.1/audio.ogg", {
				timeoutMs: 15000,
				maxSizeBytes: 1024 * 1024,
			});
			expect.unreachable("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(AudioFetchError);
			expect((e as AudioFetchError).category).toBe("blocked_host");
		}
	});

	it("rejects localhost URLs", async () => {
		try {
			await fetchAudio("https://localhost/audio.ogg", {
				timeoutMs: 15000,
				maxSizeBytes: 1024 * 1024,
			});
			expect.unreachable("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(AudioFetchError);
			expect((e as AudioFetchError).category).toBe("blocked_host");
		}
	});

	it("rejects private network URLs (RFC1918)", async () => {
		try {
			await fetchAudio("https://192.168.1.1/audio.ogg", {
				timeoutMs: 15000,
				maxSizeBytes: 1024 * 1024,
			});
			expect.unreachable("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(AudioFetchError);
			expect((e as AudioFetchError).category).toBe("blocked_host");
		}
	});

	it("rejects link-local URLs", async () => {
		try {
			await fetchAudio("https://169.254.1.1/audio.ogg", {
				timeoutMs: 15000,
				maxSizeBytes: 1024 * 1024,
			});
			expect.unreachable("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(AudioFetchError);
			expect((e as AudioFetchError).category).toBe("blocked_host");
		}
	});

	it("wraps timeout errors as AudioFetchError", async () => {
		globalThis.fetch = vi.fn().mockRejectedValueOnce(new DOMException("aborted", "AbortError"));

		try {
			await fetchAudio("https://example.com/slow.ogg", {
				timeoutMs: 100,
				maxSizeBytes: 1024 * 1024,
			});
			expect.unreachable("Should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(AudioFetchError);
			expect((e as AudioFetchError).category).toBe("timeout");
		}
	});

	it("uses redirect error to prevent redirect following (per M3 finding)", async () => {
		const audioData = new Uint8Array([1]);
		globalThis.fetch = vi.fn().mockResolvedValueOnce(
			new Response(audioData, {
				status: 200,
				headers: { "content-type": "audio/ogg", "content-length": "1" },
			}),
		);

		await fetchAudio("https://example.com/audio.ogg", {
			timeoutMs: 15000,
			maxSizeBytes: 1024 * 1024,
		});

		expect(globalThis.fetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ redirect: "error" }),
		);
	});
});
