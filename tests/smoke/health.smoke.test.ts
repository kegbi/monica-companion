/**
 * Health endpoint smoke tests.
 *
 * Verifies every service in the Docker Compose stack responds
 * to GET /health with 200 and the expected service name.
 */

import { describe, expect, it } from "vitest";
import { smokeRequest } from "./helpers.js";
import { loadSmokeConfig } from "./smoke-config.js";

const config = loadSmokeConfig();

const services = [
	{ name: "ai-router", url: config.AI_ROUTER_URL },
	{ name: "user-management", url: config.USER_MANAGEMENT_URL },
	{ name: "delivery", url: config.DELIVERY_URL },
	{ name: "voice-transcription", url: config.VOICE_TRANSCRIPTION_URL },
];

describe("service health checks", () => {
	for (const svc of services) {
		it(`${svc.name} /health returns 200`, async () => {
			const { status, body } = await smokeRequest(`${svc.url}/health`);
			expect(status).toBe(200);
			expect(body).toMatchObject({ status: "ok", service: svc.name });
		});
	}
});
