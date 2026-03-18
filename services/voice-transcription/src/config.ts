import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { type GuardrailConfig, loadGuardrailConfig } from "@monica-companion/guardrails";
import { z } from "zod/v4";

const voiceTranscriptionConfigSchema = z.object({
	OPENAI_API_KEY: z.string().min(1),
	WHISPER_MODEL: z.string().min(1).default("whisper-1"),
	WHISPER_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
	WHISPER_MAX_FILE_SIZE_BYTES: z.coerce
		.number()
		.int()
		.positive()
		.default(25 * 1024 * 1024),
	FETCH_URL_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
	WHISPER_COST_PER_MINUTE_USD: z.coerce.number().positive().default(0.006),
	INBOUND_ALLOWED_CALLERS: z.string().optional(),
});

export interface Config {
	auth: AuthConfig;
	openaiApiKey: string;
	whisperModel: string;
	whisperTimeoutMs: number;
	whisperMaxFileSizeBytes: number;
	fetchUrlTimeoutMs: number;
	whisperCostPerMinuteUsd: number;
	redisUrl: string;
	guardrails: GuardrailConfig;
	inboundAllowedCallers: string[];
}

/**
 * Parses INBOUND_ALLOWED_CALLERS from a comma-separated env var.
 * Defaults to ["telegram-bridge"] when not set.
 */
function parseAllowedCallers(raw: string | undefined): string[] {
	if (!raw) return ["telegram-bridge"];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const auth = loadAuthConfig(env);
	const guardrails = loadGuardrailConfig(env);
	const parsed = voiceTranscriptionConfigSchema.parse(env);

	return {
		auth,
		openaiApiKey: parsed.OPENAI_API_KEY,
		whisperModel: parsed.WHISPER_MODEL,
		whisperTimeoutMs: parsed.WHISPER_TIMEOUT_MS,
		whisperMaxFileSizeBytes: parsed.WHISPER_MAX_FILE_SIZE_BYTES,
		fetchUrlTimeoutMs: parsed.FETCH_URL_TIMEOUT_MS,
		whisperCostPerMinuteUsd: parsed.WHISPER_COST_PER_MINUTE_USD,
		redisUrl: guardrails.redisUrl,
		guardrails,
		inboundAllowedCallers: parseAllowedCallers(parsed.INBOUND_ALLOWED_CALLERS),
	};
}
