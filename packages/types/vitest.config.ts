import { defineConfig } from "vitest/config";
import { pkg } from "../../config/vitest-resolve.js";

export default defineConfig({
	resolve: {
		alias: {
			"zod/v4": pkg("zod", "v4"),
			zod: pkg("zod"),
		},
	},
});
