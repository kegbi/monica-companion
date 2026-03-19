/**
 * LLM smoke test configuration.
 *
 * Resolves service URLs, API keys, and database connection from environment
 * variables. OPENAI_API_KEY is required with no default -- it must come from
 * the environment or GitHub Actions secrets, never hardcoded.
 */

import { z } from "zod/v4";

const LlmSmokeConfigSchema = z.object({
	OPENAI_API_KEY: z.string().min(1),
	AI_ROUTER_URL: z.string().default("http://localhost:3002"),
	JWT_SECRET: z.string().min(1),
	POSTGRES_URL: z
		.string()
		.default("postgresql://monica:monica_dev@localhost:5432/monica_companion"),
});

export type LlmSmokeConfig = z.infer<typeof LlmSmokeConfigSchema>;

let cached: LlmSmokeConfig | undefined;

export function loadLlmSmokeConfig(): LlmSmokeConfig {
	if (cached) return cached;

	const result = LlmSmokeConfigSchema.safeParse(process.env);
	if (!result.success) {
		throw new Error(
			[
				"LLM smoke test configuration is missing or invalid.",
				"",
				"Required:",
				"  OPENAI_API_KEY  (real OpenAI key, never hardcoded)",
				"  JWT_SECRET      (must match the running ai-router instance)",
				"",
				"Optional overrides (with defaults):",
				"  AI_ROUTER_URL   http://localhost:3002",
				"  POSTGRES_URL    postgresql://monica:monica_dev@localhost:5432/monica_companion",
				"",
				z.prettifyError(result.error),
			].join("\n"),
		);
	}

	cached = result.data;
	return cached;
}

/**
 * Reset the cached config. Only used in tests.
 */
export function resetLlmSmokeConfig(): void {
	cached = undefined;
}
