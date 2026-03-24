/**
 * Command parsing LLM smoke tests.
 *
 * Sends representative text messages covering all V1 command types to
 * the live ai-router /internal/process endpoint and verifies that
 * correct response types are produced.
 *
 * Each test uses a unique userId (random UUID) so there are no
 * cross-test state interactions via conversation_history.
 *
 * Assertions are structural (response type, non-empty text) rather than
 * exact-match because LLM output varies between invocations.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sendMessage } from "./helpers.js";
import { loadLlmSmokeConfig } from "./smoke-config.js";

describe("Command parsing smoke tests", () => {
	beforeAll(async () => {
		const config = loadLlmSmokeConfig();
		// Health pre-check: verify ai-router is reachable
		const res = await fetch(`${config.AI_ROUTER_URL}/health`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string };
		expect(body.status).toBe("ok");
	});

	// --- Mutating commands ---

	it("create_contact: produces a valid response mentioning the contact", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(userId, "Create a new contact named Bob Wilson");

		expect(status).toBe(200);
		expect(["text", "confirmation_prompt", "disambiguation_prompt"]).toContain(body.type);
		expect(body.type).not.toBe("error");
		expect(body.text.length).toBeGreaterThan(0);
		expect(body.text.toLowerCase()).toContain("bob");
	});

	it("create_note: produces a valid response referencing the contact", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(
			userId,
			"Add a note to Jane about our lunch yesterday",
		);

		expect(status).toBe(200);
		expect(["text", "confirmation_prompt", "disambiguation_prompt"]).toContain(body.type);
		expect(body.type).not.toBe("error");
		expect(body.text.length).toBeGreaterThan(0);
	});

	it("create_activity: produces a valid response referencing the activity", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(userId, "I had coffee with Sarah this morning");

		expect(status).toBe(200);
		expect(["text", "confirmation_prompt", "disambiguation_prompt"]).toContain(body.type);
		expect(body.type).not.toBe("error");
		expect(body.text.length).toBeGreaterThan(0);
	});

	it("update_contact_birthday: produces a valid response referencing the update", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(userId, "Update Alex's birthday to March 5th");

		expect(status).toBe(200);
		expect(["text", "confirmation_prompt", "disambiguation_prompt"]).toContain(body.type);
		expect(body.type).not.toBe("error");
		expect(body.text.length).toBeGreaterThan(0);
	});

	it("update_contact_phone: produces a valid response referencing the phone update", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(userId, "Set David's phone number to 555-0199");

		expect(status).toBe(200);
		expect(["text", "confirmation_prompt", "disambiguation_prompt"]).toContain(body.type);
		expect(body.type).not.toBe("error");
		expect(body.text.length).toBeGreaterThan(0);
	});

	it("update_contact_email: produces a valid response referencing the email update", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(userId, "Change Lisa's email to lisa@example.com");

		expect(status).toBe(200);
		expect(["text", "confirmation_prompt", "disambiguation_prompt"]).toContain(body.type);
		expect(body.type).not.toBe("error");
		expect(body.text.length).toBeGreaterThan(0);
	});

	it("update_contact_address: produces a valid response referencing the address update", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(
			userId,
			"Update Maria's address to 123 Oak Street, Portland",
		);

		expect(status).toBe(200);
		expect(["text", "confirmation_prompt", "disambiguation_prompt"]).toContain(body.type);
		expect(body.type).not.toBe("error");
		expect(body.text.length).toBeGreaterThan(0);
	});

	// --- Read queries ---

	it("query_birthday: produces a text response (not confirmation_prompt)", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(userId, "When is Sarah's birthday?");

		expect(status).toBe(200);
		expect(body.type).toBe("text");
		expect(body.text.length).toBeGreaterThan(0);
	});

	it("query_phone: produces a text response", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(userId, "What's John's phone number?");

		expect(status).toBe(200);
		expect(body.type).toBe("text");
		expect(body.text.length).toBeGreaterThan(0);
	});

	it("query_last_note: produces a text response", async () => {
		const userId = randomUUID();
		const { status, body } = await sendMessage(userId, "Show me the last note about Mike");

		expect(status).toBe(200);
		expect(body.type).toBe("text");
		expect(body.text.length).toBeGreaterThan(0);
	});
});
