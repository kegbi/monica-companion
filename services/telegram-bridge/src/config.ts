import { z } from "zod/v4";

const configSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3001),
	TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
	RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
	RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
});

export interface Config {
	port: number;
	telegramWebhookSecret: string;
	rateLimitWindowMs: number;
	rateLimitMaxRequests: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = configSchema.parse(env);
	return {
		port: parsed.PORT,
		telegramWebhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET,
		rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
		rateLimitMaxRequests: parsed.RATE_LIMIT_MAX_REQUESTS,
	};
}
