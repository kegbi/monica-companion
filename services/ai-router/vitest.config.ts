import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const pnpmStore = resolve(__dirname, "../../node_modules/.pnpm");
const honoBase = resolve(pnpmStore, "hono@4.12.8/node_modules/hono");

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
			"hono/factory": resolve(honoBase, "dist/helper/factory/index.js"),
			"hono/http-exception": resolve(honoBase, "dist/http-exception.js"),
			hono: resolve(honoBase, "dist/index.js"),
			jose: resolve(pnpmStore, "jose@6.2.1/node_modules/jose"),
			"@opentelemetry/api-logs": resolve(
				pnpmStore,
				"@opentelemetry+api-logs@0.213.0/node_modules/@opentelemetry/api-logs",
			),
			"@monica-companion/auth": resolve(__dirname, "../../packages/auth/src/index.ts"),
			"@monica-companion/types": resolve(__dirname, "../../packages/types/src/index.ts"),
			"@monica-companion/observability": resolve(
				__dirname,
				"../../packages/observability/src/index.ts",
			),
			"@monica-companion/redaction": resolve(__dirname, "../../packages/redaction/src/index.ts"),
		},
	},
	test: {
		fileParallelism: false,
	},
});
