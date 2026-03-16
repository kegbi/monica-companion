import { describe, expect, it, vi } from "vitest";
import { MonicaNetworkError } from "../errors.js";
import { type RetryOptions, withRetry, withTimeout } from "../transport.js";

describe("withTimeout", () => {
	it("returns response when fetch completes within timeout", async () => {
		const mockFetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValue(new Response("ok", { status: 200 }));
		const timedFetch = withTimeout(mockFetch, 5000);
		const response = await timedFetch("https://example.test/api/contacts");

		expect(response.status).toBe(200);
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it("throws MonicaNetworkError when fetch exceeds timeout", async () => {
		const mockFetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					const signal = init?.signal;
					if (signal) {
						signal.addEventListener("abort", () => {
							reject(new DOMException("The operation was aborted.", "AbortError"));
						});
					}
				}),
		);
		const timedFetch = withTimeout(mockFetch, 50);

		await expect(timedFetch("https://example.test/api/contacts")).rejects.toThrow(
			MonicaNetworkError,
		);
	});

	it("passes AbortSignal to the underlying fetch", async () => {
		const mockFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("ok"));
		const timedFetch = withTimeout(mockFetch, 5000);
		await timedFetch("https://example.test/api");

		const init = mockFetch.mock.calls[0][1];
		expect(init?.signal).toBeInstanceOf(AbortSignal);
	});
});

describe("withRetry", () => {
	const fastRetryOpts: RetryOptions = {
		maxRetries: 2,
		baseDelayMs: 10,
		maxDelayMs: 50,
	};

	it("returns response on first success", async () => {
		const fn = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValue(new Response("ok", { status: 200 }));
		const response = await withRetry(fn, fastRetryOpts);

		expect(response.status).toBe(200);
		expect(fn).toHaveBeenCalledOnce();
	});

	it("retries on 500 and succeeds on second attempt", async () => {
		const fn = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValueOnce(new Response("fail", { status: 500 }))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));

		const response = await withRetry(fn, fastRetryOpts);

		expect(response.status).toBe(200);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("stops after maxRetries on persistent 500", async () => {
		const fn = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValue(new Response("fail", { status: 500 }));

		const response = await withRetry(fn, fastRetryOpts);

		expect(response.status).toBe(500);
		expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
	});

	it("does not retry on 404", async () => {
		const fn = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValue(new Response("not found", { status: 404 }));

		const response = await withRetry(fn, fastRetryOpts);

		expect(response.status).toBe(404);
		expect(fn).toHaveBeenCalledOnce();
	});

	it("does not retry on 401", async () => {
		const fn = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValue(new Response("unauthorized", { status: 401 }));

		const response = await withRetry(fn, fastRetryOpts);

		expect(response.status).toBe(401);
		expect(fn).toHaveBeenCalledOnce();
	});

	it("retries on 429 and respects Retry-After header", async () => {
		const headers429 = new Headers({ "Retry-After": "0" });
		const fn = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: headers429 }))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));

		const response = await withRetry(fn, fastRetryOpts);

		expect(response.status).toBe(200);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("retries on network error (thrown exception)", async () => {
		const fn = vi
			.fn<() => Promise<Response>>()
			.mockRejectedValueOnce(new Error("fetch failed"))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));

		const response = await withRetry(fn, fastRetryOpts);

		expect(response.status).toBe(200);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("throws original error after maxRetries exhausted on network errors", async () => {
		const fn = vi.fn<() => Promise<Response>>().mockRejectedValue(new Error("fetch failed"));

		await expect(withRetry(fn, fastRetryOpts)).rejects.toThrow("fetch failed");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("applies exponential backoff with jitter (delay increases)", async () => {
		const delays: number[] = [];
		const _originalSetTimeout = globalThis.setTimeout;
		vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: TimerHandler, ms?: number) => {
			delays.push(ms ?? 0);
			if (typeof fn === "function") fn();
			return 0 as unknown as ReturnType<typeof originalSetTimeout>;
		});

		const fn = vi
			.fn<() => Promise<Response>>()
			.mockResolvedValue(new Response("fail", { status: 500 }));

		await withRetry(fn, { maxRetries: 2, baseDelayMs: 100, maxDelayMs: 5000 });

		expect(delays).toHaveLength(2);
		// First delay should be around baseDelayMs (100) + jitter
		expect(delays[0]).toBeGreaterThanOrEqual(100);
		expect(delays[0]).toBeLessThanOrEqual(350); // 100 + up to 200 jitter + margin
		// Second delay should be larger (exponential)
		expect(delays[1]).toBeGreaterThanOrEqual(200);

		vi.restoreAllMocks();
	});
});
