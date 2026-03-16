import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: ["src/__smoke__/**", "node_modules/**", "dist/**"],
	},
});
