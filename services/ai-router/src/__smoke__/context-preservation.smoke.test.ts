/**
 * Context preservation LLM smoke tests.
 *
 * Tests that the ai-router correctly resolves pronouns and implicit
 * references across multiple turns using the conversation_turns context.
 *
 * Both messages in each test use the same userId so the persistTurn node
 * stores the first turn and the loadContext node reads it back for the
 * second invocation.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sendMessage } from "./helpers.js";
import { loadLlmSmokeConfig } from "./smoke-config.js";

describe("Context preservation smoke tests", () => {
	beforeAll(async () => {
		const config = loadLlmSmokeConfig();
		const res = await fetch(`${config.AI_ROUTER_URL}/health`);
		expect(res.status).toBe(200);
	});

	it("pronoun resolution: 'his' resolves to the previously mentioned contact", async () => {
		const userId = randomUUID();

		// Turn 1: Mention John explicitly
		const first = await sendMessage(userId, "Add a note to John about our meeting");

		expect(first.status).toBe(200);
		expect(first.body.type).not.toBe("error");
		expect(first.body.text.length).toBeGreaterThan(0);

		// Turn 2: Use pronoun "his" which should resolve to John
		const second = await sendMessage(userId, "Also update his birthday to March 5th");

		expect(second.status).toBe(200);
		expect(second.body.type).not.toBe("error");
		expect(second.body.text.length).toBeGreaterThan(0);
		// The response should reference John, not ask "who do you mean?"
		const lowerText = second.body.text.toLowerCase();
		expect(lowerText).not.toMatch(/\bwho\b.*\bmean\b/);
		expect(lowerText).not.toMatch(/\bwhich\b.*\bcontact\b/);
	});

	it("implicit reference: 'her' resolves from previous query context", async () => {
		const userId = randomUUID();

		// Turn 1: Ask about Sarah
		const first = await sendMessage(userId, "What's Sarah's birthday?");

		expect(first.status).toBe(200);
		expect(first.body.type).not.toBe("error");
		expect(first.body.text.length).toBeGreaterThan(0);

		// Turn 2: Implicit reference to Sarah via "her"
		const second = await sendMessage(userId, "Add a note to her about the party");

		expect(second.status).toBe(200);
		expect(second.body.type).not.toBe("error");
		expect(second.body.text.length).toBeGreaterThan(0);
		// Should not ask for clarification about who "her" is
		const lowerText = second.body.text.toLowerCase();
		expect(lowerText).not.toMatch(/\bwho\b.*\bmean\b/);
	});
});
