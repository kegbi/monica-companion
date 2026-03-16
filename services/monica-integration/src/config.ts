import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { z } from "zod/v4";

const configSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3004),
	USER_MANAGEMENT_URL: z.string().min(1),
	MONICA_DEFAULT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
	MONICA_RETRY_MAX: z.coerce.number().int().min(0).default(2),
	ALLOW_PRIVATE_NETWORK_TARGETS: z
		.enum(["true", "false"])
		.default("false")
		.transform((v) => v === "true"),
});

export interface Config {
	port: number;
	userManagementUrl: string;
	monicaDefaultTimeoutMs: number;
	monicaRetryMax: number;
	allowPrivateNetworkTargets: boolean;
	auth: AuthConfig;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = configSchema.parse(env);
	const auth = loadAuthConfig(env);
	return {
		port: parsed.PORT,
		userManagementUrl: parsed.USER_MANAGEMENT_URL,
		monicaDefaultTimeoutMs: parsed.MONICA_DEFAULT_TIMEOUT_MS,
		monicaRetryMax: parsed.MONICA_RETRY_MAX,
		allowPrivateNetworkTargets: parsed.ALLOW_PRIVATE_NETWORK_TARGETS,
		auth,
	};
}
