import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { z } from "zod/v4";

const configSchema = z.object({
	DATABASE_URL: z.string().min(1),
	HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export interface Config {
	connectorRegistry: Record<string, string>;
	connectorAudience: (connectorType: string) => string;
	databaseUrl: string;
	httpTimeoutMs: number;
	auth: AuthConfig;
	fetchFn?: typeof globalThis.fetch;
}

/**
 * Parses CONNECTOR_URL_ prefix env vars into a connector registry.
 * Falls back to TELEGRAM_BRIDGE_URL for backward compatibility.
 * Example: CONNECTOR_URL_TELEGRAM=http://telegram-bridge:3009
 */
function parseConnectorRegistry(env: Record<string, string | undefined>): Record<string, string> {
	const registry: Record<string, string> = {};
	const prefix = "CONNECTOR_URL_";

	for (const [key, value] of Object.entries(env)) {
		if (key.startsWith(prefix) && value) {
			const connectorType = key.slice(prefix.length).toLowerCase();
			registry[connectorType] = value;
		}
	}

	// Backward compat: TELEGRAM_BRIDGE_URL populates telegram entry if not already set
	if (!registry.telegram && env.TELEGRAM_BRIDGE_URL) {
		registry.telegram = env.TELEGRAM_BRIDGE_URL;
	}

	return registry;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = configSchema.parse(env);
	const auth = loadAuthConfig(env);
	const connectorRegistry = parseConnectorRegistry(env);

	if (Object.keys(connectorRegistry).length === 0) {
		throw new Error(
			"At least one CONNECTOR_URL_<TYPE> env var is required (e.g., CONNECTOR_URL_TELEGRAM)",
		);
	}

	return {
		connectorRegistry,
		connectorAudience: (connectorType: string) => `${connectorType}-bridge`,
		databaseUrl: parsed.DATABASE_URL,
		httpTimeoutMs: parsed.HTTP_TIMEOUT_MS,
		auth,
	};
}
