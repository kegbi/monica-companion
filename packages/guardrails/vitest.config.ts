import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const pnpmStore = resolve(__dirname, "../../node_modules/.pnpm");
const honoBase = resolve(pnpmStore, "hono@4.12.8/node_modules/hono");

export default defineConfig({
	resolve: {
		alias: {
			"zod/v4": resolve(pnpmStore, "zod@4.3.6/node_modules/zod/v4"),
			zod: resolve(pnpmStore, "zod@4.3.6/node_modules/zod"),
			"hono/factory": resolve(honoBase, "dist/helper/factory/index.js"),
			"hono/http-exception": resolve(honoBase, "dist/http-exception.js"),
			hono: resolve(honoBase, "dist/index.js"),
			jose: resolve(pnpmStore, "jose@6.2.1/node_modules/jose"),
			"@opentelemetry/api": resolve(
				pnpmStore,
				"@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api",
			),
			"@monica-companion/auth": resolve(__dirname, "../auth/src/index.ts"),
		},
	},
	test: {
		fileParallelism: false,
		exclude: ["**/node_modules/**", "**/dist/**"],
	},
});
