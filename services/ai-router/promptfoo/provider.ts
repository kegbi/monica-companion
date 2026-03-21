/**
 * Custom promptfoo provider wrapping createIntentClassifier().
 *
 * This provider is loaded by promptfoo via the file:// reference in
 * promptfooconfig.yaml. It instantiates the intent classifier once
 * per eval run and returns IntentClassificationResult as JSON.
 *
 * Security:
 * - OPENAI_API_KEY is read from environment, never logged or hardcoded.
 * - Utterance text and PII are NOT logged -- only case IDs and pass/fail
 *   status are safe to emit.
 * - Throws immediately if the API key is missing or fake.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createIntentClassifier } from "../src/graph/llm.js";
import { buildSystemPrompt } from "../src/graph/system-prompt.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

if (!OPENAI_API_KEY || OPENAI_API_KEY.startsWith("sk-fake")) {
	throw new Error(
		"promptfoo provider requires a real OPENAI_API_KEY. " +
			"Set a valid key or skip promptfoo eval via check-thresholds.ts.",
	);
}

const classifier = createIntentClassifier({ openaiApiKey: OPENAI_API_KEY });

/**
 * promptfoo ApiProvider implementation.
 *
 * Exported as the default export for ESM compatibility with promptfoo's
 * file:// provider loading mechanism.
 */
export default class IntentClassifierProvider {
	id() {
		return "intent-classifier";
	}

	async callApi(prompt: string): Promise<{ output: string }> {
		const systemPrompt = buildSystemPrompt();
		const messages = [new SystemMessage(systemPrompt), new HumanMessage(prompt)];
		const result = await classifier.invoke(messages);
		return { output: JSON.stringify(result) };
	}
}
