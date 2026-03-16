import { describe, expect, it } from "vitest";
import { MonicaApiError, MonicaNetworkError, MonicaPaginationCapError } from "../errors.js";

describe("MonicaApiError", () => {
	it("parses a 404 error body with string message", async () => {
		const body = {
			error: {
				message: "The contact has not been found.",
				error_code: 31,
			},
		};
		const response = new Response(JSON.stringify(body), { status: 404 });
		const err = await MonicaApiError.fromResponse(response);

		expect(err).toBeInstanceOf(MonicaApiError);
		expect(err.statusCode).toBe(404);
		expect(err.monicaErrorCode).toBe(31);
		expect(err.monicaMessages).toEqual(["The contact has not been found."]);
		expect(err.isRetryable).toBe(false);
		expect(err.message).toContain("Monica API error");
	});

	it("parses a 422 error body with array messages", async () => {
		const body = {
			error: {
				message: ["The initial date field is required.", "The contact id field is required."],
				error_code: 32,
			},
		};
		const response = new Response(JSON.stringify(body), { status: 422 });
		const err = await MonicaApiError.fromResponse(response);

		expect(err.statusCode).toBe(422);
		expect(err.monicaErrorCode).toBe(32);
		expect(err.monicaMessages).toEqual([
			"The initial date field is required.",
			"The contact id field is required.",
		]);
		expect(err.isRetryable).toBe(false);
	});

	it("marks 5xx as retryable", async () => {
		const body = {
			error: { message: "Internal server error", error_code: 0 },
		};
		for (const status of [500, 502, 503, 504]) {
			const response = new Response(JSON.stringify(body), { status });
			const err = await MonicaApiError.fromResponse(response);
			expect(err.isRetryable).toBe(true);
		}
	});

	it("marks 429 as retryable", async () => {
		const body = {
			error: { message: "Too many requests", error_code: 0 },
		};
		const response = new Response(JSON.stringify(body), { status: 429 });
		const err = await MonicaApiError.fromResponse(response);
		expect(err.isRetryable).toBe(true);
	});

	it("marks 4xx (non-429) as non-retryable", async () => {
		const body = {
			error: { message: "Bad request", error_code: 0 },
		};
		for (const status of [400, 401, 403, 404, 422]) {
			const response = new Response(JSON.stringify(body), { status });
			const err = await MonicaApiError.fromResponse(response);
			expect(err.isRetryable).toBe(false);
		}
	});

	it("handles non-JSON response body gracefully", async () => {
		const response = new Response("Not JSON", { status: 500 });
		const err = await MonicaApiError.fromResponse(response);
		expect(err.statusCode).toBe(500);
		expect(err.monicaErrorCode).toBeUndefined();
		expect(err.monicaMessages).toEqual([]);
		expect(err.isRetryable).toBe(true);
	});

	it("handles unexpected JSON shape gracefully", async () => {
		const response = new Response(JSON.stringify({ unexpected: true }), {
			status: 400,
		});
		const err = await MonicaApiError.fromResponse(response);
		expect(err.statusCode).toBe(400);
		expect(err.monicaErrorCode).toBeUndefined();
		expect(err.monicaMessages).toEqual([]);
	});
});

describe("MonicaNetworkError", () => {
	it("is an Error instance with message", () => {
		const err = new MonicaNetworkError("Connection timed out");
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(MonicaNetworkError);
		expect(err.message).toBe("Connection timed out");
		expect(err.name).toBe("MonicaNetworkError");
	});
});

describe("MonicaPaginationCapError", () => {
	it("is an Error instance with message", () => {
		const err = new MonicaPaginationCapError(100, 50);
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(MonicaPaginationCapError);
		expect(err.totalPages).toBe(100);
		expect(err.maxPages).toBe(50);
		expect(err.message).toContain("100");
		expect(err.message).toContain("50");
		expect(err.name).toBe("MonicaPaginationCapError");
	});
});
