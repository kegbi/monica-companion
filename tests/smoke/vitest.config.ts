import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { pkg, workspace } from "../../config/vitest-resolve.js";

export default defineConfig({
	resolve: {
		alias: {
			"zod/v4": pkg("zod", "v4"),
			zod: pkg("zod"),
			jose: pkg("jose"),
			"hono/factory": pkg("hono", "dist/helper/factory/index.js"),
			hono: pkg("hono", "dist/index.js"),
			"@monica-companion/auth": workspace("@monica-companion/auth"),
		},
	},
	test: {
		root: __dirname,
		include: ["*.smoke.test.ts"],
		fileParallelism: false,
		testTimeout: 15_000,
		hookTimeout: 30_000,
		reporters: ["default", "junit"],
		outputFile: {
			junit: resolve(__dirname, "results/results.xml"),
		},
	},
});
