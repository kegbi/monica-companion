import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { z } from "zod/v4";

const configSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3001),
	TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
	RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
	RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
	USER_MANAGEMENT_URL: z.string().min(1).optional(),
});

export interface Config {
	port: number;
	telegramWebhookSecret: string;
	rateLimitWindowMs: number;
	rateLimitMaxRequests: number;
	userManagementUrl?: string;
	auth: AuthConfig;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = configSchema.parse(env);
	const auth = loadAuthConfig(env);
	return {
		port: parsed.PORT,
		telegramWebhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET,
		rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
		rateLimitMaxRequests: parsed.RATE_LIMIT_MAX_REQUESTS,
		userManagementUrl: parsed.USER_MANAGEMENT_URL,
		auth,
	};
}
