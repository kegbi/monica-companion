import { defineConfig } from "vitest/config";
import { otelAliases, pkg, workspace } from "../../config/vitest-resolve.js";

/**
 * Vitest config for benchmark quality gate tests only.
 * Uses the shared resolver for pnpm aliases — no hardcoded versions.
 */
export default defineConfig({
	resolve: {
		alias: {
			"zod/v4": pkg("zod", "v4"),
			zod: pkg("zod"),
			"drizzle-orm/postgres-js": pkg("drizzle-orm", "postgres-js"),
			"drizzle-orm/pg-core": pkg("drizzle-orm", "pg-core"),
			"drizzle-orm": pkg("drizzle-orm"),
			postgres: pkg("postgres"),
			"hono/factory": pkg("hono", "dist/helper/factory/index.js"),
			"hono/http-exception": pkg("hono", "dist/http-exception.js"),
			hono: pkg("hono", "dist/index.js"),
			jose: pkg("jose"),
			"@langchain/openai": pkg("@langchain/openai"),
			"@langchain/core": pkg("@langchain/core"),
			...otelAliases(),
			"@monica-companion/auth": workspace("@monica-companion/auth"),
			"@monica-companion/types": workspace("@monica-companion/types"),
			"@monica-companion/observability": workspace("@monica-companion/observability"),
			"@monica-companion/redaction": workspace("@monica-companion/redaction"),
		},
	},
	test: {
		fileParallelism: false,
		include: ["src/benchmark/__tests__/**/*.test.ts"],
	},
});
