import { defineConfig } from "vitest/config";
import { pkg, workspace } from "../../config/vitest-resolve.js";

export default defineConfig({
	resolve: {
		alias: {
			"zod/v4": pkg("zod", "v4"),
			zod: pkg("zod"),
			"hono/factory": pkg("hono", "dist/helper/factory/index.js"),
			"hono/http-exception": pkg("hono", "dist/http-exception.js"),
			hono: pkg("hono", "dist/index.js"),
			jose: pkg("jose"),
			"@opentelemetry/api": pkg("@opentelemetry/api"),
			"@monica-companion/auth": workspace("@monica-companion/auth"),
		},
	},
	test: {
		fileParallelism: false,
		exclude: ["**/node_modules/**", "**/dist/**"],
	},
});
