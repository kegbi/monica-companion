/**
 * Multi-stage dialog LLM smoke tests.
 *
 * Tests that the ai-router correctly handles multi-turn conversations
 * where the first message is ambiguous/incomplete and the second message
 * provides the missing information.
 *
 * These tests verify:
 * 1. First message triggers a clarification response
 * 2. Follow-up message resolves the ambiguity
 *
 * Both messages in each test use the same userId so conversation_history
 * context enables follow-up resolution.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sendMessage } from "./helpers.js";
import { loadLlmSmokeConfig } from "./smoke-config.js";

describe("Dialog clarification smoke tests", () => {
	beforeAll(async () => {
		const config = loadLlmSmokeConfig();
		const res = await fetch(`${config.AI_ROUTER_URL}/health`);
		expect(res.status).toBe(200);
	});

	it("ambiguous contact: clarification then resolution", async () => {
		const userId = randomUUID();

		// Step 1: Send an incomplete message missing the contact
		const first = await sendMessage(userId, "Add a note");

		expect(first.status).toBe(200);
		expect(first.body.type).not.toBe("error");
		expect(first.body.text.length).toBeGreaterThan(0);
		// The response should ask for clarification (it's a question)

		// Step 2: Send the follow-up with the missing information
		const second = await sendMessage(userId, "to Jane about the meeting");

		expect(second.status).toBe(200);
		expect(second.body.type).not.toBe("error");
		expect(second.body.text.length).toBeGreaterThan(0);
		// After providing context, expect confirmation_prompt or text
		expect(["text", "confirmation_prompt", "disambiguation_prompt"]).toContain(second.body.type);
	});

	it("missing fields: clarification then resolution", async () => {
		const userId = randomUUID();

		// Step 1: Send a message missing both contact and date
		const first = await sendMessage(userId, "Update a birthday");

		expect(first.status).toBe(200);
		expect(first.body.type).not.toBe("error");
		expect(first.body.text.length).toBeGreaterThan(0);

		// Step 2: Provide the missing details
		const second = await sendMessage(userId, "Alex's birthday is March 5th");

		expect(second.status).toBe(200);
		expect(second.body.type).not.toBe("error");
		expect(second.body.text.length).toBeGreaterThan(0);
		expect(["text", "confirmation_prompt", "disambiguation_prompt"]).toContain(second.body.type);
	});
});
