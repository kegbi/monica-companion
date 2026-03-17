import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { z } from "zod/v4";

const configSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3005),
	DATABASE_URL: z.string().min(1),
	REDIS_URL: z.string().min(1),
	MONICA_INTEGRATION_URL: z.string().min(1),
	DELIVERY_URL: z.string().min(1).default("http://delivery:3006"),
	USER_MANAGEMENT_URL: z.string().min(1).default("http://user-management:3007"),
	SCHEDULER_MAX_RETRIES: z.coerce.number().int().positive().default(3),
	SCHEDULER_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(1000),
	CATCH_UP_WINDOW_HOURS: z.coerce.number().int().positive().default(6),
	REMINDER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
	HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export interface Config {
	port: number;
	databaseUrl: string;
	redisUrl: string;
	auth: AuthConfig;
	monicaIntegrationUrl: string;
	deliveryUrl: string;
	userManagementUrl: string;
	maxRetries: number;
	retryBackoffMs: number;
	catchUpWindowHours: number;
	reminderPollIntervalMs: number;
	httpTimeoutMs: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = configSchema.parse(env);
	const auth = loadAuthConfig(env);
	return {
		port: parsed.PORT,
		databaseUrl: parsed.DATABASE_URL,
		redisUrl: parsed.REDIS_URL,
		auth,
		monicaIntegrationUrl: parsed.MONICA_INTEGRATION_URL,
		deliveryUrl: parsed.DELIVERY_URL,
		userManagementUrl: parsed.USER_MANAGEMENT_URL,
		maxRetries: parsed.SCHEDULER_MAX_RETRIES,
		retryBackoffMs: parsed.SCHEDULER_RETRY_BACKOFF_MS,
		catchUpWindowHours: parsed.CATCH_UP_WINDOW_HOURS,
		reminderPollIntervalMs: parsed.REMINDER_POLL_INTERVAL_MS,
		httpTimeoutMs: parsed.HTTP_TIMEOUT_MS,
	};
}
