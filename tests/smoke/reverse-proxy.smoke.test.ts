/**
 * Reverse proxy (Caddy) smoke tests.
 *
 * Verifies that Caddy routes public traffic correctly and that
 * internal service health/API endpoints are NOT exposed.
 */

import { describe, expect, it } from "vitest";
import { smokeRequest } from "./helpers.js";
import { loadSmokeConfig } from "./smoke-config.js";

const config = loadSmokeConfig();

describe("caddy reverse proxy", () => {
	it("returns 404 for unknown paths", async () => {
		const { status } = await smokeRequest(`${config.CADDY_URL}/nonexistent`);
		expect(status).toBe(404);
	});

	it("does not expose /health on any service", async () => {
		const { status } = await smokeRequest(`${config.CADDY_URL}/health`);
		expect(status).toBe(404);
	});

	it("does not expose internal API routes", async () => {
		const paths = ["/internal/process", "/internal/resolve-contact", "/api/ai-router/health"];
		for (const path of paths) {
			const { status } = await smokeRequest(`${config.CADDY_URL}${path}`);
			expect(status).toBe(404);
		}
	});

	it("does not include Server header", async () => {
		const { headers } = await smokeRequest(`${config.CADDY_URL}/anything`);
		expect(headers.get("server")).toBeNull();
	});
});
