import { z } from "zod/v4";

export const RateLimitedError = z.object({
	error: z.literal("rate_limited"),
	message: z.string(),
	retryAfterMs: z.number().int().nonnegative(),
});

export const ConcurrencyExceededError = z.object({
	error: z.literal("concurrency_exceeded"),
	message: z.string(),
});

export const BudgetExhaustedError = z.object({
	error: z.literal("budget_exhausted"),
	message: z.string(),
});

export const ServiceDegradedError = z.object({
	error: z.literal("service_degraded"),
	message: z.string(),
});

export const GuardrailErrorResponse = z.discriminatedUnion("error", [
	RateLimitedError,
	ConcurrencyExceededError,
	BudgetExhaustedError,
	ServiceDegradedError,
]);

export type GuardrailErrorResponse = z.infer<typeof GuardrailErrorResponse>;
export type RateLimitedError = z.infer<typeof RateLimitedError>;
export type ConcurrencyExceededError = z.infer<typeof ConcurrencyExceededError>;
export type BudgetExhaustedError = z.infer<typeof BudgetExhaustedError>;
export type ServiceDegradedError = z.infer<typeof ServiceDegradedError>;
