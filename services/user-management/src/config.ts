import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { z } from "zod/v4";

const configSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3007),
	DATABASE_URL: z.string().min(1),
	SETUP_TOKEN_SECRET: z.string().min(32),
	SETUP_BASE_URL: z.string().min(1),
	SETUP_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
});

export interface Config {
	port: number;
	databaseUrl: string;
	setupTokenSecret: string;
	setupBaseUrl: string;
	setupTokenTtlMinutes: number;
	auth: AuthConfig;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = configSchema.parse(env);
	const auth = loadAuthConfig(env);
	return {
		port: parsed.PORT,
		databaseUrl: parsed.DATABASE_URL,
		setupTokenSecret: parsed.SETUP_TOKEN_SECRET,
		setupBaseUrl: parsed.SETUP_BASE_URL,
		setupTokenTtlMinutes: parsed.SETUP_TOKEN_TTL_MINUTES,
		auth,
	};
}
