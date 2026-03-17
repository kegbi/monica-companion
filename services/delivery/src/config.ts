import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { z } from "zod/v4";

const configSchema = z.object({
	TELEGRAM_BRIDGE_URL: z.string().min(1),
});

export interface Config {
	telegramBridgeUrl: string;
	auth: AuthConfig;
	fetchFn?: typeof globalThis.fetch;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = configSchema.parse(env);
	const auth = loadAuthConfig(env);
	return {
		telegramBridgeUrl: parsed.TELEGRAM_BRIDGE_URL,
		auth,
	};
}
