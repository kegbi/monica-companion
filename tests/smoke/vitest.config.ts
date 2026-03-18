import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const pnpmStore = resolve(__dirname, "../../node_modules/.pnpm");
const honoBase = resolve(pnpmStore, "hono@4.12.8/node_modules/hono");

export default defineConfig({
	resolve: {
		alias: {
			"zod/v4": resolve(pnpmStore, "zod@4.3.6/node_modules/zod/v4"),
			zod: resolve(pnpmStore, "zod@4.3.6/node_modules/zod"),
			jose: resolve(pnpmStore, "jose@6.2.1/node_modules/jose"),
			"hono/factory": resolve(honoBase, "dist/helper/factory/index.js"),
			hono: resolve(honoBase, "dist/index.js"),
			"@monica-companion/auth": resolve(__dirname, "../../packages/auth/src/index.ts"),
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
