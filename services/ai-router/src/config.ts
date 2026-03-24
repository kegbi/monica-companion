import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { type GuardrailConfig, loadGuardrailConfig } from "@monica-companion/guardrails";
import { z } from "zod/v4";

const configSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3002),
	DATABASE_URL: z.string().min(1),
	PENDING_COMMAND_TTL_MINUTES: z.coerce.number().int().positive().default(30),
	MONICA_INTEGRATION_URL: z.string().min(1),
	DELIVERY_URL: z.string().min(1),
	SCHEDULER_URL: z.string().min(1),
	USER_MANAGEMENT_URL: z.string().min(1),
	INBOUND_ALLOWED_CALLERS: z.string().optional(),
	OPENAI_API_KEY: z.string().min(1),
	MAX_CONVERSATION_TURNS: z.coerce.number().int().positive().default(10),
	AUTO_CONFIRM_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.95),
	LLM_BASE_URL: z.string().min(1).default("https://openrouter.ai/api/v1"),
	LLM_API_KEY: z.string().min(1),
	LLM_MODEL_ID: z.string().min(1).default("qwen/qwen3-235b-a22b"),
	HISTORY_INACTIVITY_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(3600000),
});

export interface Config {
	port: number;
	databaseUrl: string;
	pendingCommandTtlMinutes: number;
	monicaIntegrationUrl: string;
	deliveryUrl: string;
	schedulerUrl: string;
	userManagementUrl: string;
	openaiApiKey: string;
	maxConversationTurns: number;
	autoConfirmConfidenceThreshold: number;
	llmBaseUrl: string;
	llmApiKey: string;
	llmModelId: string;
	historyInactivitySweepIntervalMs: number;
	auth: AuthConfig;
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
	const parsed = configSchema.parse(env);
	const auth = loadAuthConfig(env);
	const guardrails = loadGuardrailConfig(env);
	return {
		port: parsed.PORT,
		databaseUrl: parsed.DATABASE_URL,
		pendingCommandTtlMinutes: parsed.PENDING_COMMAND_TTL_MINUTES,
		monicaIntegrationUrl: parsed.MONICA_INTEGRATION_URL,
		deliveryUrl: parsed.DELIVERY_URL,
		schedulerUrl: parsed.SCHEDULER_URL,
		userManagementUrl: parsed.USER_MANAGEMENT_URL,
		openaiApiKey: parsed.OPENAI_API_KEY,
		maxConversationTurns: parsed.MAX_CONVERSATION_TURNS,
		autoConfirmConfidenceThreshold: parsed.AUTO_CONFIRM_CONFIDENCE_THRESHOLD,
		llmBaseUrl: parsed.LLM_BASE_URL,
		llmApiKey: parsed.LLM_API_KEY,
		llmModelId: parsed.LLM_MODEL_ID,
		historyInactivitySweepIntervalMs: parsed.HISTORY_INACTIVITY_SWEEP_INTERVAL_MS,
		auth,
		guardrails,
		inboundAllowedCallers: parseAllowedCallers(parsed.INBOUND_ALLOWED_CALLERS),
	};
}
