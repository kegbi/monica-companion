import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
	output: "server",
	adapter: node({
		mode: "standalone",
	}),
	security: {
		// Disable Astro's built-in CSRF check — we enforce our own double-submit
		// cookie CSRF validation in middleware.ts with timing-safe comparison.
		checkOrigin: false,
	},
	vite: {
		plugins: [tailwindcss()],
	},
});
