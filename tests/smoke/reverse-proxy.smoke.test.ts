/**
 * Reverse proxy (Caddy) smoke tests.
 *
 * Verifies that Caddy routes public traffic correctly and that
 * internal service health/API endpoints are NOT exposed.
 *
 * Skipped when Caddy is not running (e.g. CI without Docker Compose).
 */

import { describe, expect, it } from "vitest";
import { smokeRequest } from "./helpers.js";
import { loadSmokeConfig } from "./smoke-config.js";

const config = loadSmokeConfig();

async function isCaddyAvailable(): Promise<boolean> {
	try {
		await smokeRequest(`${config.CADDY_URL}/`, { timeout: 2000 });
		return true;
	} catch {
		return false;
	}
}

describe("caddy reverse proxy", async () => {
	const available = await isCaddyAvailable();
	if (!available) {
		it.skip("caddy not available — skipping reverse proxy tests", () => {});
		return;
	}

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
