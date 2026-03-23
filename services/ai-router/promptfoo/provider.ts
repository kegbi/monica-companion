/**
 * Custom promptfoo provider wrapping the tool-calling agent.
 *
 * This provider is loaded by promptfoo via the file:// reference in
 * promptfooconfig.yaml. It instantiates the OpenAI SDK once per eval run
 * and returns the LLM's tool-call output as JSON.
 *
 * Supports conversation context injection via test vars:
 * - `conversationHistory`: JSON array of OpenAI-format messages injected
 *   between the system message and user utterance so single-turn promptfoo
 *   cases can simulate multi-turn context (e.g. clarification follow-ups,
 *   pending command disambiguation).
 *
 * Security:
 * - LLM_API_KEY is read from environment, never logged or hardcoded.
 * - Utterance text and PII are NOT logged -- only case IDs and pass/fail
 *   status are safe to emit.
 * - Throws immediately if the API key is missing or fake.
 */

import OpenAI from "openai";
import { buildAgentSystemPrompt } from "../src/agent/system-prompt.js";
import { TOOL_DEFINITIONS } from "../src/agent/tools.js";

const LLM_API_KEY = process.env.LLM_API_KEY ?? "";
const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1";
const LLM_MODEL_ID = process.env.LLM_MODEL_ID ?? "qwen/qwen3-235b-a22b";

if (!LLM_API_KEY || LLM_API_KEY.startsWith("sk-fake")) {
	throw new Error(
		"promptfoo provider requires LLM_API_KEY. " +
			"Set a valid key or skip promptfoo eval via check-thresholds.ts.",
	);
}

const openai = new OpenAI({ baseURL: LLM_BASE_URL, apiKey: LLM_API_KEY });

/**
 * promptfoo ApiProvider implementation for the tool-calling agent.
 *
 * Exported as the default export for ESM compatibility with promptfoo's
 * file:// provider loading mechanism.
 */
export default class ToolCallingProvider {
	id() {
		return "tool-calling-agent";
	}

	async callApi(
		prompt: string,
		context?: { vars?: Record<string, unknown> },
	): Promise<{ output: string }> {
		const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
			role: "system",
			content: buildAgentSystemPrompt(),
		};
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [systemMessage];

		// Inject conversationHistory between system and user message
		const rawHistory = context?.vars?.conversationHistory;
		if (typeof rawHistory === "string" && rawHistory.length > 0) {
			const historyMessages = JSON.parse(rawHistory) as OpenAI.Chat.ChatCompletionMessageParam[];
			messages.push(...historyMessages);
		}

		messages.push({ role: "user", content: prompt });

		const completion = await openai.chat.completions.create({
			model: LLM_MODEL_ID,
			messages,
			tools: TOOL_DEFINITIONS,
			temperature: 0,
		});

		const choice = completion.choices[0];
		const result = {
			text: choice?.message?.content ?? null,
			tool_calls:
				choice?.message?.tool_calls?.map((tc) => ({
					function: { name: tc.function.name, arguments: tc.function.arguments },
				})) ?? [],
		};
		return { output: JSON.stringify(result) };
	}
}
