/**
 * Verification for create_contact with birthday_date (single-call approach).
 * Run via: vitest run --config vitest.config.ts promptfoo/verify-multistep.test.ts
 *
 * Requires LLM_API_KEY in environment. Skips when absent.
 */

import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "../src/agent/system-prompt.js";
import { TOOL_DEFINITIONS } from "../src/agent/tools.js";

const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const LLM_MODEL_ID = process.env.LLM_MODEL_ID ?? "gpt-5.4-mini";

interface ToolCall {
	id: string;
	type: string;
	function: { name: string; arguments: string };
}

async function chatCompletion(messages: unknown[]): Promise<{
	content: string | null;
	tool_calls: ToolCall[];
}> {
	const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${LLM_API_KEY}`,
		},
		body: JSON.stringify({
			model: LLM_MODEL_ID,
			messages,
			tools: TOOL_DEFINITIONS,
			temperature: 0,
		}),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`LLM API ${res.status}: ${text.substring(0, 300)}`);
	}

	const data = (await res.json()) as {
		choices: Array<{
			message: { content: string | null; tool_calls?: ToolCall[] };
		}>;
	};

	const msg = data.choices[0]?.message;
	return { content: msg?.content ?? null, tool_calls: msg?.tool_calls ?? [] };
}

const shouldRun = LLM_API_KEY && !LLM_API_KEY.startsWith("sk-fake");

describe.skipIf(!shouldRun)("create_contact with birthday_date (real LLM)", () => {
	const systemPrompt = buildAgentSystemPrompt();

	it("includes birthday_date in create_contact when user provides birthday", async () => {
		const result = await chatCompletion([
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "Create contact Hottabych with birthday 14.09.1994" },
		]);

		const createCall = result.tool_calls.find((tc) => tc.function.name === "create_contact");
		expect(createCall).toBeTruthy();

		const args = JSON.parse(createCall!.function.arguments);
		expect(args.first_name.toLowerCase()).toContain("hottabych");
		expect(args.birthday_date).toBeTruthy();
		expect(args.birthday_date).toContain("1994");
	}, 30_000);

	it("does NOT include birthday_date when user only provides name", async () => {
		const result = await chatCompletion([
			{ role: "system", content: systemPrompt },
			{ role: "user", content: "Create a new contact John Smith" },
		]);

		const createCall = result.tool_calls.find((tc) => tc.function.name === "create_contact");
		expect(createCall).toBeTruthy();

		const args = JSON.parse(createCall!.function.arguments);
		expect(args.first_name.toLowerCase()).toContain("john");
		expect(args.birthday_date).toBeFalsy();
	}, 30_000);

	it("includes nickname AND birthday_date when both are provided", async () => {
		const result = await chatCompletion([
			{ role: "system", content: systemPrompt },
			{
				role: "user",
				content: "Add new contact Katya, nickname Katyusha, born January 15 1988",
			},
		]);

		const createCall = result.tool_calls.find((tc) => tc.function.name === "create_contact");
		expect(createCall).toBeTruthy();

		const args = JSON.parse(createCall!.function.arguments);
		expect(args.nickname).toBeTruthy();
		expect(args.birthday_date).toBeTruthy();
		expect(args.birthday_date).toContain("1988");
	}, 30_000);
});
