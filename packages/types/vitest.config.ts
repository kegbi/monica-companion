import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"zod/v4": resolve(__dirname, "../../node_modules/.pnpm/zod@4.3.6/node_modules/zod/v4"),
			zod: resolve(__dirname, "../../node_modules/.pnpm/zod@4.3.6/node_modules/zod"),
		},
	},
});
