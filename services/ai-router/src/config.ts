import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { z } from "zod/v4";

const configSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3002),
	DATABASE_URL: z.string().min(1),
	PENDING_COMMAND_TTL_MINUTES: z.coerce.number().int().positive().default(30),
	EXPIRY_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
	MONICA_INTEGRATION_URL: z.string().min(1),
});

export interface Config {
	port: number;
	databaseUrl: string;
	pendingCommandTtlMinutes: number;
	expirySweepIntervalMs: number;
	monicaIntegrationUrl: string;
	auth: AuthConfig;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = configSchema.parse(env);
	const auth = loadAuthConfig(env);
	return {
		port: parsed.PORT,
		databaseUrl: parsed.DATABASE_URL,
		pendingCommandTtlMinutes: parsed.PENDING_COMMAND_TTL_MINUTES,
		expirySweepIntervalMs: parsed.EXPIRY_SWEEP_INTERVAL_MS,
		monicaIntegrationUrl: parsed.MONICA_INTEGRATION_URL,
		auth,
	};
}
