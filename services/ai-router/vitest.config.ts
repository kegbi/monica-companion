import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const pnpmStore = resolve(__dirname, "../../node_modules/.pnpm");

export default defineConfig({
	resolve: {
		alias: {
			"zod/v4": resolve(pnpmStore, "zod@4.3.6/node_modules/zod/v4"),
			zod: resolve(pnpmStore, "zod@4.3.6/node_modules/zod"),
			"drizzle-orm/postgres-js": resolve(
				pnpmStore,
				"drizzle-orm@0.45.1_@opentelemetry+api@1.9.0_postgres@3.4.8/node_modules/drizzle-orm/postgres-js",
			),
			"drizzle-orm/pg-core": resolve(
				pnpmStore,
				"drizzle-orm@0.45.1_@opentelemetry+api@1.9.0_postgres@3.4.8/node_modules/drizzle-orm/pg-core",
			),
			"drizzle-orm": resolve(
				pnpmStore,
				"drizzle-orm@0.45.1_@opentelemetry+api@1.9.0_postgres@3.4.8/node_modules/drizzle-orm",
			),
			postgres: resolve(pnpmStore, "postgres@3.4.8/node_modules/postgres"),
			"@monica-companion/auth": resolve(__dirname, "../../packages/auth/src/index.ts"),
			"@monica-companion/types": resolve(__dirname, "../../packages/types/src/index.ts"),
			"@monica-companion/observability": resolve(
				__dirname,
				"../../packages/observability/src/index.ts",
			),
		},
	},
	test: {
		fileParallelism: false,
	},
});
