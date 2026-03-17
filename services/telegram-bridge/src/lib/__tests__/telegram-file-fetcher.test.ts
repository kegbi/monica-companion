import { describe, expect, it, vi } from "vitest";
import { TelegramFileFetcher } from "../telegram-file-fetcher";

describe("TelegramFileFetcher", () => {
	it("downloads file binary from Telegram API", async () => {
		const mockFetch = vi.fn(async (url: string) => {
			if (url.includes("/getFile")) {
				return new Response(
					JSON.stringify({
						ok: true,
						result: { file_id: "abc", file_path: "voice/file_0.oga" },
					}),
				);
			}
			if (url.includes("/file/")) {
				return new Response(new Uint8Array([1, 2, 3, 4]), {
					headers: { "content-type": "audio/ogg" },
				});
			}
			return new Response("Not found", { status: 404 });
		});

		const fetcher = new TelegramFileFetcher("123:TOKEN", mockFetch as never);
		const result = await fetcher.downloadFile("abc");

		expect(result.buffer).toBeInstanceOf(ArrayBuffer);
		expect(new Uint8Array(result.buffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("throws on getFile API error", async () => {
		const mockFetch = vi.fn(async () => {
			return new Response(JSON.stringify({ ok: false }), { status: 400 });
		});

		const fetcher = new TelegramFileFetcher("123:TOKEN", mockFetch as never);
		await expect(fetcher.downloadFile("bad-id")).rejects.toThrow();
	});
});
