/**
 * Out-of-scope rejection LLM smoke tests.
 *
 * Sends messages that are outside the assistant's capabilities and verifies:
 * 1. The response is a polite decline (type: "text", not "error")
 * 2. No pending command was created in the database
 *
 * The DB assertion is the definitive proof that no mutation was triggered,
 * since it directly verifies the pending_commands table state.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { assertNoPendingCommands, sendMessage } from "./helpers.js";
import { loadLlmSmokeConfig } from "./smoke-config.js";

describe("Out-of-scope rejection smoke tests", () => {
	beforeAll(async () => {
		const config = loadLlmSmokeConfig();
		const res = await fetch(`${config.AI_ROUTER_URL}/health`);
		expect(res.status).toBe(200);
	});

	it("weather question: responds with text and creates no pending command", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(userId, "What's the weather like today?");

		expect(status).toBe(200);
		expect(body.type).toBe("text");
		expect(body.type).not.toBe("confirmation_prompt");
		expect(body.text.length).toBeGreaterThan(0);

		// Verify no mutation was triggered
		const noPending = await assertNoPendingCommands(userId);
		expect(noPending).toBe(true);
	});

	it("trivia question: responds with text and creates no pending command", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(userId, "Who won the World Cup in 2022?");

		expect(status).toBe(200);
		expect(body.type).toBe("text");
		expect(body.type).not.toBe("confirmation_prompt");
		expect(body.text.length).toBeGreaterThan(0);

		const noPending = await assertNoPendingCommands(userId);
		expect(noPending).toBe(true);
	});

	it("code generation request: responds with text and creates no pending command", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(userId, "Write me a Python function to sort a list");

		expect(status).toBe(200);
		expect(body.type).toBe("text");
		expect(body.type).not.toBe("confirmation_prompt");
		expect(body.text.length).toBeGreaterThan(0);

		const noPending = await assertNoPendingCommands(userId);
		expect(noPending).toBe(true);
	});

	it("joke request: responds with text and creates no pending command", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(userId, "Tell me a joke");

		expect(status).toBe(200);
		expect(body.type).toBe("text");
		expect(body.text.length).toBeGreaterThan(0);

		const noPending = await assertNoPendingCommands(userId);
		expect(noPending).toBe(true);
	});
});
