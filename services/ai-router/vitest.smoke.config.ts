import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { pkg, workspace } from "../../config/vitest-resolve.js";

/**
 * Vitest config for LLM smoke tests.
 *
 * These tests require a live Docker stack with ai-router running,
 * a real LLM_API_KEY, JWT_SECRET, and POSTGRES_URL.
 *
 * Timeouts are extended to accommodate LLM response times.
 * Tests run sequentially to avoid race conditions on shared state.
 */
export default defineConfig({
	resolve: {
		alias: {
			"zod/v4": pkg("zod", "v4"),
			zod: pkg("zod"),
			postgres: pkg("postgres"),
			jose: pkg("jose"),
			"hono/factory": pkg("hono", "dist/helper/factory/index.js"),
			"hono/http-exception": pkg("hono", "dist/http-exception.js"),
			hono: pkg("hono", "dist/index.js"),
			"@monica-companion/auth": workspace("@monica-companion/auth"),
			"@monica-companion/types": workspace("@monica-companion/types"),
		},
	},
	test: {
		root: __dirname,
		fileParallelism: false,
		include: ["src/__smoke__/**/*.smoke.test.ts"],
		testTimeout: 60_000,
		hookTimeout: 120_000,
		retry: 1,
		reporters: ["default", "junit"],
		outputFile: {
			junit: resolve(__dirname, "smoke-results/results.xml"),
		},
	},
});
