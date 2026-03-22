import { defineConfig } from "vitest/config";
import { otelAliases, pkg, workspace } from "../../config/vitest-resolve.js";

export default defineConfig({
	resolve: {
		alias: {
			"zod/v4": pkg("zod", "v4"),
			zod: pkg("zod"),
			"hono/body-limit": pkg("hono", "dist/middleware/body-limit/index.js"),
			"hono/factory": pkg("hono", "dist/helper/factory/index.js"),
			"hono/http-exception": pkg("hono", "dist/http-exception.js"),
			hono: pkg("hono", "dist/index.js"),
			jose: pkg("jose"),
			grammy: pkg("grammy"),
			ioredis: pkg("ioredis"),
			...otelAliases(),
			"@monica-companion/auth": workspace("@monica-companion/auth"),
			"@monica-companion/types": workspace("@monica-companion/types"),
			"@monica-companion/observability": workspace("@monica-companion/observability"),
			"@monica-companion/redaction": workspace("@monica-companion/redaction"),
		},
	},
	test: {
		fileParallelism: false,
		exclude: ["**/node_modules/**", "**/dist/**"],
	},
});
