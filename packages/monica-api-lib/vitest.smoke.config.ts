import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/__smoke__/**/*.smoke.test.ts"],
		// Disable file parallelism to respect Monica's 60 req/min rate limit
		fileParallelism: false,
		// Extended timeout for real API calls (network latency + rate limiting)
		testTimeout: 30_000,
		hookTimeout: 60_000,
		// JUnit reporter for CI artifact upload
		reporters: ["default", "junit"],
		outputFile: {
			junit: "smoke-results/results.xml",
		},
	},
});
