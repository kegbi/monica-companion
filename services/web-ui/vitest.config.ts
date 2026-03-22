import { defineConfig } from "vitest/config";
import { otelAliases, pkg, workspace } from "../../config/vitest-resolve.js";

export default defineConfig({
	resolve: {
		alias: {
			"zod/v4": pkg("zod", "v4"),
			zod: pkg("zod"),
			jose: pkg("jose"),
			...otelAliases(),
			"@monica-companion/auth": workspace("@monica-companion/auth"),
			"@monica-companion/types": workspace("@monica-companion/types"),
			"@monica-companion/observability": workspace("@monica-companion/observability"),
		},
	},
	test: {
		exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
	},
});
