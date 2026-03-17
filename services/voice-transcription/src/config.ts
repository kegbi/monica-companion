import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";

export interface Config {
	auth: AuthConfig;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const auth = loadAuthConfig(env);
	return { auth };
}
