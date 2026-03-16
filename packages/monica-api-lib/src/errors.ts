import { ErrorResponse } from "./schemas/common.js";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** Structured error thrown when the Monica API returns a non-2xx response. */
export class MonicaApiError extends Error {
	readonly statusCode: number;
	readonly monicaErrorCode: number | undefined;
	readonly monicaMessages: string[];
	readonly isRetryable: boolean;

	constructor(statusCode: number, monicaErrorCode: number | undefined, monicaMessages: string[]) {
		const summary = monicaMessages.length > 0 ? monicaMessages.join("; ") : `HTTP ${statusCode}`;
		super(`Monica API error: ${summary}`);
		this.name = "MonicaApiError";
		this.statusCode = statusCode;
		this.monicaErrorCode = monicaErrorCode;
		this.monicaMessages = monicaMessages;
		this.isRetryable = RETRYABLE_STATUS_CODES.has(statusCode);
	}

	/**
	 * Build a MonicaApiError from a fetch Response.
	 * Attempts to parse the body as Monica's standard error envelope.
	 * Falls back gracefully when the body is not valid JSON or has an unexpected shape.
	 */
	static async fromResponse(response: Response): Promise<MonicaApiError> {
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			return new MonicaApiError(response.status, undefined, []);
		}

		const parsed = ErrorResponse.safeParse(body);
		if (!parsed.success) {
			return new MonicaApiError(response.status, undefined, []);
		}

		const { message, error_code } = parsed.data.error;
		const messages = Array.isArray(message) ? message : [message];
		return new MonicaApiError(response.status, error_code, messages);
	}
}

/** Error thrown on network-level failures (timeout, DNS, connection refused). */
export class MonicaNetworkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MonicaNetworkError";
	}
}

/** Error thrown when a paginated fetch exceeds the safety cap. */
export class MonicaPaginationCapError extends Error {
	readonly totalPages: number;
	readonly maxPages: number;

	constructor(totalPages: number, maxPages: number) {
		super(`Pagination cap exceeded: API reports ${totalPages} pages but the cap is ${maxPages}`);
		this.name = "MonicaPaginationCapError";
		this.totalPages = totalPages;
		this.maxPages = maxPages;
	}
}
