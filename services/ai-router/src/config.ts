import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { type GuardrailConfig, loadGuardrailConfig } from "@monica-companion/guardrails";
import { z } from "zod/v4";

const configSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3002),
	DATABASE_URL: z.string().min(1),
	PENDING_COMMAND_TTL_MINUTES: z.coerce.number().int().positive().default(30),
	EXPIRY_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
	MONICA_INTEGRATION_URL: z.string().min(1),
	DELIVERY_URL: z.string().min(1).optional(),
	INBOUND_ALLOWED_CALLERS: z.string().optional(),
});

export interface Config {
	port: number;
	databaseUrl: string;
	pendingCommandTtlMinutes: number;
	expirySweepIntervalMs: number;
	monicaIntegrationUrl: string;
	deliveryUrl?: string;
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
		expirySweepIntervalMs: parsed.EXPIRY_SWEEP_INTERVAL_MS,
		monicaIntegrationUrl: parsed.MONICA_INTEGRATION_URL,
		deliveryUrl: parsed.DELIVERY_URL,
		auth,
		guardrails,
		inboundAllowedCallers: parseAllowedCallers(parsed.INBOUND_ALLOWED_CALLERS),
	};
}
