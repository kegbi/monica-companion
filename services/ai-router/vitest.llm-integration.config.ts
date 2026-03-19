import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { pkg, workspace } from "../../config/vitest-resolve.js";

/**
 * Vitest config for LLM integration tests that call real OpenAI.
 *
 * These tests require a valid OPENAI_API_KEY env var.
 * They are excluded from normal CI and run via the dedicated
 * llm-integration GitHub Actions workflow (manual dispatch).
 */
export default defineConfig({
	resolve: {
		alias: {
			"zod/v4": pkg("zod", "v4"),
			zod: pkg("zod"),
			"@langchain/openai": pkg("@langchain/openai"),
			"@langchain/core": pkg("@langchain/core"),
			"@monica-companion/types": workspace("@monica-companion/types"),
		},
	},
	test: {
		root: __dirname,
		fileParallelism: false,
		include: ["src/__tests__/llm-integration/**/*.test.ts"],
		testTimeout: 60_000,
		hookTimeout: 30_000,
		reporters: ["default", "junit"],
		outputFile: {
			junit: resolve(__dirname, "llm-integration-results/results.xml"),
		},
	},
});
