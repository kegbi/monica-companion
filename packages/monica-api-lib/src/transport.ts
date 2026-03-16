import { MonicaNetworkError } from "./errors.js";

export interface RetryOptions {
	/** Maximum number of retries after the initial attempt. Default: 2. */
	maxRetries: number;
	/** Base delay in milliseconds for exponential backoff. Default: 500. */
	baseDelayMs: number;
	/** Maximum delay in milliseconds. Default: 5000. */
	maxDelayMs: number;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Wrap a fetch function with an AbortController-based timeout.
 * Throws MonicaNetworkError if the request does not complete within timeoutMs.
 */
export function withTimeout(
	fetchFn: typeof globalThis.fetch,
	timeoutMs: number,
): typeof globalThis.fetch {
	return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetchFn(input, {
				...init,
				signal: controller.signal,
			});
			return response;
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				throw new MonicaNetworkError(`Request timed out after ${timeoutMs}ms`);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelay(attempt: number, options: RetryOptions): number {
	const exponentialDelay = options.baseDelayMs * 2 ** attempt;
	const jitter = Math.random() * 200;
	return Math.min(exponentialDelay + jitter, options.maxDelayMs);
}

function parseRetryAfter(response: Response): number | undefined {
	const header = response.headers.get("Retry-After");
	if (header === null) return undefined;
	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return seconds * 1000;
	}
	return undefined;
}

/**
 * Retry a function that returns a Promise<Response>.
 * Retries on network errors and retryable HTTP status codes (429, 5xx).
 * On 429, respects the Retry-After header if present.
 */
export async function withRetry(
	fn: () => Promise<Response>,
	options: RetryOptions,
): Promise<Response> {
	let lastError: unknown;

	for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
		try {
			const response = await fn();

			if (!RETRYABLE_STATUS_CODES.has(response.status)) {
				return response;
			}

			// Retryable status but no retries left
			if (attempt === options.maxRetries) {
				return response;
			}

			// Compute delay
			let delayMs: number;
			if (response.status === 429) {
				const retryAfterMs = parseRetryAfter(response);
				delayMs = retryAfterMs ?? computeDelay(attempt, options);
			} else {
				delayMs = computeDelay(attempt, options);
			}

			await sleep(delayMs);
		} catch (err) {
			lastError = err;
			if (attempt === options.maxRetries) {
				throw err;
			}
			await sleep(computeDelay(attempt, options));
		}
	}

	// Should not be reached, but for type safety
	throw lastError;
}
