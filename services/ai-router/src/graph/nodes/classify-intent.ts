/**
 * classifyIntent graph node.
 *
 * Invokes the structured-output LLM to classify the user's utterance
 * into one of five intent categories and extract command metadata.
 *
 * Passes conversation history and active pending command context to
 * the system prompt so the LLM can resolve pronouns and follow-ups.
 *
 * For callback_action events without an active pending command, returns
 * a clarification_response placeholder without calling the LLM.
 * For callback_action events WITH an active pending command, constructs
 * a synthetic message describing the callback and passes it through
 * the LLM with full context.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { trace } from "@opentelemetry/api";
import type { IntentClassificationResult } from "../intent-schemas.js";
import type { ConversationAnnotation } from "../state.js";
import { buildSystemPrompt } from "../system-prompt.js";

const tracer = trace.getTracer("ai-router");

type State = typeof ConversationAnnotation.State;
type Update = typeof ConversationAnnotation.Update;

interface Classifier {
	invoke(messages: unknown[]): Promise<IntentClassificationResult>;
}

/**
 * Builds a synthetic user message for a callback_action event.
 * Format: "User selected callback action: {action}, data: {data}"
 * This provides the LLM with structured context about the user's selection
 * when resolving disambiguation or other multi-step flows.
 */
function buildSyntheticCallbackMessage(action: string, data: string): string {
	return `User selected callback action: ${action}, data: ${data}`;
}

/**
 * Creates a classifyIntent node function that uses the given classifier.
 * The classifier is injected to allow mocking in tests.
 */
export function createClassifyIntentNode(classifier: Classifier) {
	return async function classifyIntentNode(state: State): Promise<Update> {
		return tracer.startActiveSpan("ai-router.graph.classify_intent", async (span) => {
			try {
				const event = state.inboundEvent;

				// For callback_action events without an active pending command,
				// return a placeholder without calling the LLM.
				if (event.type === "callback_action" && !state.activePendingCommand) {
					const placeholderResult: IntentClassificationResult = {
						intent: "clarification_response",
						detectedLanguage: "en",
						userFacingText: `Received callback: ${event.action}`,
						commandType: null,
						contactRef: null,
						commandPayload: null,
						confidence: 1.0,
					};
					span.setAttribute("ai-router.intent", placeholderResult.intent);
					return { intentClassification: placeholderResult };
				}

				// Determine the user text to send to the LLM
				let userText: string;
				if (event.type === "callback_action") {
					// Synthetic message for callback with active pending command
					userText = buildSyntheticCallbackMessage(event.action, event.data);
				} else {
					userText = event.type === "text_message" ? event.text : event.transcribedText;
				}

				try {
					const systemPrompt = buildSystemPrompt({
						recentTurns: state.recentTurns,
						activePendingCommand: state.activePendingCommand,
					});

					const messages = [new SystemMessage(systemPrompt), new HumanMessage(userText)];

					const result = await classifier.invoke(messages);
					span.setAttribute("ai-router.intent", result.intent);
					return { intentClassification: result };
				} catch (_error) {
					// On LLM failure, return a safe fallback. Do not log the raw error
					// as it may contain API keys or PII from the request.
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
					span.setAttribute("ai-router.intent", fallbackResult.intent);
					return { intentClassification: fallbackResult };
				}
			} finally {
				span.end();
			}
		});
	};
}
