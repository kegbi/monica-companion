import { defineConfig } from "vitest/config";
import { pkg, workspace } from "../../config/vitest-resolve.js";

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
			"@opentelemetry/api-logs": pkg("@opentelemetry/api-logs"),
			"@opentelemetry/api": pkg("@opentelemetry/api"),
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
