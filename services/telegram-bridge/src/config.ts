import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { z } from "zod/v4";

const configSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3001),
	TELEGRAM_MODE: z.enum(["webhook", "polling"]).default("webhook"),
	TELEGRAM_WEBHOOK_SECRET: z.string().min(1).optional(),
	TELEGRAM_BOT_TOKEN: z.string().min(1),
	AI_ROUTER_URL: z.string().min(1),
	VOICE_TRANSCRIPTION_URL: z.string().min(1),
	USER_MANAGEMENT_URL: z.string().min(1),
	REDIS_URL: z.string().min(1),
	RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
	RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
	AI_ROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
	VOICE_TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
	USER_MANAGEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
});

export interface Config {
	port: number;
	telegramMode: "webhook" | "polling";
	telegramWebhookSecret: string;
	telegramBotToken: string;
	aiRouterUrl: string;
	voiceTranscriptionUrl: string;
	userManagementUrl: string;
	redisUrl: string;
	rateLimitWindowMs: number;
	rateLimitMaxRequests: number;
	aiRouterTimeoutMs: number;
	voiceTranscriptionTimeoutMs: number;
	userManagementTimeoutMs: number;
	auth: AuthConfig;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = configSchema.parse(env);
	if (parsed.TELEGRAM_MODE === "webhook" && !parsed.TELEGRAM_WEBHOOK_SECRET) {
		throw new Error("TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_MODE=webhook");
	}
	const auth = loadAuthConfig(env);
	return {
		port: parsed.PORT,
		telegramMode: parsed.TELEGRAM_MODE,
		telegramWebhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET ?? "",
		telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
		aiRouterUrl: parsed.AI_ROUTER_URL,
		voiceTranscriptionUrl: parsed.VOICE_TRANSCRIPTION_URL,
		userManagementUrl: parsed.USER_MANAGEMENT_URL,
		redisUrl: parsed.REDIS_URL,
		rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
		rateLimitMaxRequests: parsed.RATE_LIMIT_MAX_REQUESTS,
		aiRouterTimeoutMs: parsed.AI_ROUTER_TIMEOUT_MS,
		voiceTranscriptionTimeoutMs: parsed.VOICE_TRANSCRIPTION_TIMEOUT_MS,
		userManagementTimeoutMs: parsed.USER_MANAGEMENT_TIMEOUT_MS,
		auth,
	};
}
