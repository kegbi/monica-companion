/**
 * LLM client factory for intent classification.
 *
 * Creates a ChatOpenAI instance bound with structured output for
 * intent classification. The factory accepts an API key parameter
 * to avoid importing from env directly.
 */

import { ChatOpenAI } from "@langchain/openai";
import { IntentClassificationResultSchema } from "./intent-schemas.js";

export interface IntentClassifierConfig {
	openaiApiKey: string;
}

/**
 * Creates an intent classifier: a ChatOpenAI model bound to produce
 * structured output matching IntentClassificationResultSchema.
 *
 * Configuration:
 * - Model: gpt-5.4-mini
 * - Temperature: 0 (deterministic)
 * - Reasoning effort: medium
 * - Timeout: 30 seconds
 */
export function createIntentClassifier(config: IntentClassifierConfig) {
	const model = new ChatOpenAI({
		modelName: "gpt-5.4-mini",
		temperature: 0,
		openAIApiKey: config.openaiApiKey,
		timeout: 30000,
		modelKwargs: {
			reasoning_effort: "medium",
		},
	});

	return model.withStructuredOutput(IntentClassificationResultSchema, {
		name: "intent_classification",
	});
}
