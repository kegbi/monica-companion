import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod/v4";

/**
 * Zod schema for smoke test environment configuration.
 * Requires a running Monica instance with valid credentials.
 */
const SmokeConfigSchema = z.object({
	MONICA_SMOKE_BASE_URL: z.url().describe("Base URL of the Monica smoke test instance"),
	MONICA_SMOKE_API_TOKEN: z.string().min(1).describe("API token for the Monica smoke instance"),
});

export type SmokeConfig = z.infer<typeof SmokeConfigSchema>;

/**
 * Loads smoke test configuration from environment variables or a `.env.smoke` file.
 *
 * Resolution order:
 * 1. Process environment variables (`MONICA_SMOKE_BASE_URL`, `MONICA_SMOKE_API_TOKEN`)
 * 2. `.env.smoke` file in the scripts directory (project root `scripts/.env.smoke`)
 * 3. `.env.smoke` file in the current working directory
 *
 * Throws with a clear error message if configuration is missing or invalid.
 */
export function loadSmokeConfig(): SmokeConfig {
	const env: Record<string, string | undefined> = {
		MONICA_SMOKE_BASE_URL: process.env.MONICA_SMOKE_BASE_URL,
		MONICA_SMOKE_API_TOKEN: process.env.MONICA_SMOKE_API_TOKEN,
	};

	// If env vars are not set, try loading from .env.smoke files
	if (!env.MONICA_SMOKE_BASE_URL || !env.MONICA_SMOKE_API_TOKEN) {
		const envFromFile = loadEnvFile();
		if (envFromFile) {
			env.MONICA_SMOKE_BASE_URL = env.MONICA_SMOKE_BASE_URL || envFromFile.MONICA_SMOKE_BASE_URL;
			env.MONICA_SMOKE_API_TOKEN = env.MONICA_SMOKE_API_TOKEN || envFromFile.MONICA_SMOKE_API_TOKEN;
		}
	}

	const result = SmokeConfigSchema.safeParse(env);
	if (!result.success) {
		const issues = z.prettifyError(result.error);
		throw new Error(
			[
				"Smoke test configuration is missing or invalid.",
				"",
				"Required environment variables:",
				"  MONICA_SMOKE_BASE_URL  - Base URL of the Monica smoke test instance",
				"  MONICA_SMOKE_API_TOKEN - API token for the Monica smoke instance",
				"",
				"You can set these via:",
				"  1. Environment variables",
				"  2. A scripts/.env.smoke file (created by the seed script)",
				"  3. A .env.smoke file in the current working directory",
				"",
				"To create a smoke test environment, run:",
				"  docker compose -f docker-compose.monica-smoke.yml up -d",
				"  pnpm tsx scripts/seed-monica-smoke.ts",
				"",
				"Validation errors:",
				issues,
			].join("\n"),
		);
	}

	return result.data;
}

/**
 * Attempts to load a `.env.smoke` file from known locations.
 * Returns a key-value map, or undefined if no file is found.
 */
function loadEnvFile(): Record<string, string> | undefined {
	const candidates = [
		resolve(process.cwd(), "scripts", ".env.smoke"),
		resolve(process.cwd(), "..", "..", "scripts", ".env.smoke"),
		resolve(process.cwd(), ".env.smoke"),
	];

	for (const filePath of candidates) {
		try {
			const content = readFileSync(filePath, "utf-8");
			return parseEnvFile(content);
		} catch {
			// File does not exist or is not readable; try next candidate
		}
	}

	return undefined;
}

/**
 * Parses a simple `.env` file format (KEY=VALUE lines, # comments, blank lines).
 */
function parseEnvFile(content: string): Record<string, string> {
	const result: Record<string, string> = {};

	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const eqIndex = trimmed.indexOf("=");
		if (eqIndex === -1) continue;

		const key = trimmed.slice(0, eqIndex).trim();
		let value = trimmed.slice(eqIndex + 1).trim();

		// Remove surrounding quotes if present
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		result[key] = value;
	}

	return result;
}
