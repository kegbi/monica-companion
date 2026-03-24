/**
 * Trivial smoke test that validates the LLM smoke test config loading works.
 * This is the first smoke test file, used to verify the smoke test infrastructure.
 */
import { describe, expect, it } from "vitest";
import { loadLlmSmokeConfig } from "./smoke-config.js";

describe("LLM smoke config", () => {
	it("loads config from environment variables", () => {
		const config = loadLlmSmokeConfig();
		expect(config.AI_ROUTER_URL).toBeDefined();
		expect(config.LLM_API_KEY.length).toBeGreaterThan(0);
		expect(config.JWT_SECRET.length).toBeGreaterThan(0);
	});
});
