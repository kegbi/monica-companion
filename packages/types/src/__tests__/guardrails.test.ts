import { describe, expect, it } from "vitest";
import {
	BudgetExhaustedError,
	ConcurrencyExceededError,
	GuardrailErrorResponse,
	RateLimitedError,
	ServiceDegradedError,
} from "../guardrails.js";

describe("GuardrailErrorResponse schemas", () => {
	it("parses rate_limited error", () => {
		const result = RateLimitedError.safeParse({
			error: "rate_limited",
			message: "Too many requests",
			retryAfterMs: 5000,
		});
		expect(result.success).toBe(true);
	});

	it("parses concurrency_exceeded error", () => {
		const result = ConcurrencyExceededError.safeParse({
			error: "concurrency_exceeded",
			message: "Too many concurrent requests",
		});
		expect(result.success).toBe(true);
	});

	it("parses budget_exhausted error", () => {
		const result = BudgetExhaustedError.safeParse({
			error: "budget_exhausted",
			message: "Budget limit reached",
		});
		expect(result.success).toBe(true);
	});

	it("parses service_degraded error", () => {
		const result = ServiceDegradedError.safeParse({
			error: "service_degraded",
			message: "AI features temporarily disabled",
		});
		expect(result.success).toBe(true);
	});

	it("rejects unknown error type in discriminated union", () => {
		const result = GuardrailErrorResponse.safeParse({
			error: "unknown_error",
			message: "Something went wrong",
		});
		expect(result.success).toBe(false);
	});

	it("rejects rate_limited without retryAfterMs", () => {
		const result = RateLimitedError.safeParse({
			error: "rate_limited",
			message: "Too many requests",
		});
		expect(result.success).toBe(false);
	});

	it("parses each variant via the discriminated union", () => {
		const variants = [
			{ error: "rate_limited", message: "msg", retryAfterMs: 1000 },
			{ error: "concurrency_exceeded", message: "msg" },
			{ error: "budget_exhausted", message: "msg" },
			{ error: "service_degraded", message: "msg" },
		];
		for (const v of variants) {
			const result = GuardrailErrorResponse.safeParse(v);
			expect(result.success).toBe(true);
		}
	});
});
