import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { type GuardrailConfig, loadGuardrailConfig } from "@monica-companion/guardrails";
import { z } from "zod/v4";

/** Per-minute USD pricing for supported transcription models (source: OpenAI pricing, Mar 2026) */
export const TRANSCRIPTION_MODEL_PRICING: Record<string, number> = {
	"whisper-1": 0.006,
	"gpt-4o-transcribe": 0.006,
	"gpt-4o-mini-transcribe": 0.003,
};

function getModelCostPerMinute(model: string): number {
	const cost = TRANSCRIPTION_MODEL_PRICING[model];
	if (cost === undefined) {
		throw new Error(
			`Unknown transcription model "${model}": no pricing defined. Add it to TRANSCRIPTION_MODEL_PRICING in config.ts.`,
		);
	}
	return cost;
}

const voiceTranscriptionConfigSchema = z.object({
	LLM_API_KEY: z.string().min(1),
	LLM_BASE_URL: z.string().min(1).default("https://api.openai.com/v1"),
	WHISPER_MODEL: z.string().min(1).default("gpt-4o-transcribe"),
	WHISPER_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
	WHISPER_MAX_FILE_SIZE_BYTES: z.coerce
		.number()
		.int()
		.positive()
		.default(25 * 1024 * 1024),
	FETCH_URL_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
	INBOUND_ALLOWED_CALLERS: z.string().optional(),
});

export interface Config {
	auth: AuthConfig;
	llmApiKey: string;
	llmBaseUrl: string;
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
		llmApiKey: parsed.LLM_API_KEY,
		llmBaseUrl: parsed.LLM_BASE_URL,
		whisperModel: parsed.WHISPER_MODEL,
		whisperTimeoutMs: parsed.WHISPER_TIMEOUT_MS,
		whisperMaxFileSizeBytes: parsed.WHISPER_MAX_FILE_SIZE_BYTES,
		fetchUrlTimeoutMs: parsed.FETCH_URL_TIMEOUT_MS,
		whisperCostPerMinuteUsd: getModelCostPerMinute(parsed.WHISPER_MODEL),
		redisUrl: guardrails.redisUrl,
		guardrails,
		inboundAllowedCallers: parseAllowedCallers(parsed.INBOUND_ALLOWED_CALLERS),
	};
}
