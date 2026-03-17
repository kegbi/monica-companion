import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { z } from "zod/v4";

const configSchema = z.object({
	TELEGRAM_BRIDGE_URL: z.string().min(1),
	DATABASE_URL: z.string().min(1),
	HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export interface Config {
	telegramBridgeUrl: string;
	databaseUrl: string;
	httpTimeoutMs: number;
	auth: AuthConfig;
	fetchFn?: typeof globalThis.fetch;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = configSchema.parse(env);
	const auth = loadAuthConfig(env);
	return {
		telegramBridgeUrl: parsed.TELEGRAM_BRIDGE_URL,
		databaseUrl: parsed.DATABASE_URL,
		httpTimeoutMs: parsed.HTTP_TIMEOUT_MS,
		auth,
	};
}
