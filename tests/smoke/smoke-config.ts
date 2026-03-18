/**
 * Stack smoke test configuration.
 *
 * Resolves service URLs and JWT secret from environment variables
 * or sensible defaults for a local Docker Compose stack.
 */

import { z } from "zod/v4";

const SmokeConfigSchema = z.object({
	JWT_SECRET: z.string().min(1),
	AI_ROUTER_URL: z.string().default("http://localhost:3002"),
	USER_MANAGEMENT_URL: z.string().default("http://localhost:3007"),
	DELIVERY_URL: z.string().default("http://localhost:3006"),
	VOICE_TRANSCRIPTION_URL: z.string().default("http://localhost:3003"),
	SCHEDULER_URL: z.string().default("http://localhost:3005"),
	CADDY_URL: z.string().default("http://localhost:80"),
	POSTGRES_URL: z
		.string()
		.default("postgresql://monica:monica_dev@localhost:5432/monica_companion"),
});

export type SmokeConfig = z.infer<typeof SmokeConfigSchema>;

let cached: SmokeConfig | undefined;

export function loadSmokeConfig(): SmokeConfig {
	if (cached) return cached;

	const result = SmokeConfigSchema.safeParse(process.env);
	if (!result.success) {
		throw new Error(
			[
				"Stack smoke test configuration is missing or invalid.",
				"",
				"Required: JWT_SECRET (must match docker-compose .env)",
				"",
				"Optional overrides (with defaults):",
				"  AI_ROUTER_URL           http://localhost:3002",
				"  USER_MANAGEMENT_URL     http://localhost:3007",
				"  DELIVERY_URL            http://localhost:3006",
				"  VOICE_TRANSCRIPTION_URL http://localhost:3003",
				"  SCHEDULER_URL           http://localhost:3005",
				"  CADDY_URL               http://localhost:80",
				"  POSTGRES_URL            postgresql://monica:monica_dev@localhost:5432/monica_companion",
				"",
				z.prettifyError(result.error),
			].join("\n"),
		);
	}

	cached = result.data;
	return cached;
}
