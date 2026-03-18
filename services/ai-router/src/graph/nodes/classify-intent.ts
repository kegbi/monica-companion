/**
 * classifyIntent graph node.
 *
 * Invokes the structured-output LLM to classify the user's utterance
 * into one of five intent categories and extract command metadata.
 *
 * For callback_action events, returns a clarification_response placeholder
 * without calling the LLM (full callback handling is a later task).
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { IntentClassificationResult } from "../intent-schemas.js";
import type { ConversationAnnotation } from "../state.js";
import { buildSystemPrompt } from "../system-prompt.js";

type State = typeof ConversationAnnotation.State;
type Update = typeof ConversationAnnotation.Update;

interface Classifier {
	invoke(messages: unknown[]): Promise<IntentClassificationResult>;
}

/**
 * Creates a classifyIntent node function that uses the given classifier.
 * The classifier is injected to allow mocking in tests.
 */
export function createClassifyIntentNode(classifier: Classifier) {
	return async function classifyIntentNode(state: State): Promise<Update> {
		const event = state.inboundEvent;

		// For callback_action events, return a placeholder without calling the LLM.
		// Full callback handling (confirm/cancel/disambiguate) is deferred to a later task.
		if (event.type === "callback_action") {
			// TODO: Language detection for callback actions should be addressed when
			// full callback handling is implemented (End-to-End Pipeline Wiring task).
			const placeholderResult: IntentClassificationResult = {
				intent: "clarification_response",
				detectedLanguage: "en",
				userFacingText: `Received callback: ${event.action}`,
				commandType: null,
				contactRef: null,
				commandPayload: null,
				confidence: 1.0,
			};
			return { intentClassification: placeholderResult };
		}

		// Extract user text from the event
		const userText = event.type === "text_message" ? event.text : event.transcribedText;

		try {
			const messages = [new SystemMessage(buildSystemPrompt()), new HumanMessage(userText)];

			const result = await classifier.invoke(messages);
			return { intentClassification: result };
		} catch (_error) {
			// On LLM failure, return a safe fallback. Do not log the raw error
			// as it may contain API keys or PII from the request.
			// TODO: Emit a counter metric (intent_classification_failures_total) or
			// redacted structured log entry with just the error class name when OTel is wired.
			const fallbackResult: IntentClassificationResult = {
				intent: "out_of_scope",
				detectedLanguage: "en",
				userFacingText:
					"I'm sorry, I'm having trouble processing your request right now. Please try again.",
				commandType: null,
				contactRef: null,
				commandPayload: null,
				confidence: 0,
			};
			return { intentClassification: fallbackResult };
		}
	};
}
