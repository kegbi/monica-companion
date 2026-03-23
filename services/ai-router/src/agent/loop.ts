/**
 * Agent loop — the core async loop that drives tool-calling LLM interactions.
 *
 * Replaces the LangGraph StateGraph pipeline. Loads conversation history,
 * runs the LLM with tool definitions, handles tool call stubs (Stage 1),
 * and persists updated history.
 */

import { createLogger } from "@monica-companion/observability";
import type { InboundEvent } from "@monica-companion/types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Database } from "../db/connection.js";
import type { GraphResponse } from "../graph/state.js";
import type { ConversationHistoryRow } from "./history-repository.js";
import type { LlmClient } from "./llm-client.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";
import { TOOL_DEFINITIONS } from "./tools.js";

const logger = createLogger("ai-router:agent-loop");

/** Maximum number of LLM call iterations before aborting. */
const MAX_ITERATIONS = 5;

export interface AgentLoopDeps {
	llmClient: LlmClient;
	db: Database;
	getHistory: (db: Database, userId: string) => Promise<ConversationHistoryRow | null>;
	saveHistory: (
		db: Database,
		userId: string,
		messages: unknown[],
		pendingToolCall: unknown,
	) => Promise<void>;
}

/**
 * Extract user-facing text from an inbound event.
 */
function extractUserText(event: InboundEvent): string | null {
	switch (event.type) {
		case "text_message":
			return event.text;
		case "voice_message":
			return event.transcribedText;
		case "callback_action":
			return null;
	}
}

/**
 * Run the agent loop for a single inbound event.
 *
 * Returns a GraphResponse (type: "text" | "error") compatible with
 * the existing /internal/process response contract.
 */
export async function runAgentLoop(
	deps: AgentLoopDeps,
	userId: string,
	inboundEvent: InboundEvent,
	correlationId: string,
): Promise<GraphResponse> {
	try {
		// Handle callback_action: check for pending tool call in history
		if (inboundEvent.type === "callback_action") {
			const history = await deps.getHistory(deps.db, userId);
			if (!history?.pendingToolCall) {
				return {
					type: "text",
					text: "There is no pending action to respond to. You can send me a new message.",
				};
			}
			// Stage 2 will handle pending tool call interception here.
			// For Stage 1, return a text response indicating no pending action.
			return {
				type: "text",
				text: "There is no pending action to respond to. You can send me a new message.",
			};
		}

		// Load existing conversation history
		const history = await deps.getHistory(deps.db, userId);
		const existingMessages: ChatCompletionMessageParam[] = history?.messages
			? (history.messages as ChatCompletionMessageParam[])
			: [];

		// Build the message array: system + history + new user message
		const systemMessage: ChatCompletionMessageParam = {
			role: "system",
			content: buildAgentSystemPrompt(),
		};

		const userText = extractUserText(inboundEvent);
		if (!userText) {
			return {
				type: "error",
				text: "Could not extract text from the message.",
			};
		}

		const newUserMessage: ChatCompletionMessageParam = {
			role: "user",
			content: userText,
		};

		const messages: ChatCompletionMessageParam[] = [
			systemMessage,
			...existingMessages,
			newUserMessage,
		];

		// Agent loop: call LLM, handle tool calls, repeat up to MAX_ITERATIONS
		let iteration = 0;
		while (iteration < MAX_ITERATIONS) {
			iteration++;

			const completion = await deps.llmClient.chatCompletion(messages, TOOL_DEFINITIONS);

			if (!completion.choices || completion.choices.length === 0) {
				logger.warn("LLM returned empty choices", { correlationId, userId, iteration });
				return { type: "error", text: "I was unable to process your request. Please try again." };
			}

			const choice = completion.choices[0];
			const assistantMessage = choice.message;

			// Add assistant message to history
			messages.push(assistantMessage as ChatCompletionMessageParam);

			// If no tool calls, we have a final text response
			if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
				const responseText = assistantMessage.content ?? "I could not generate a response.";

				// Save history (exclude system message for storage)
				const historyToSave = messages.slice(1); // remove system prompt
				await deps.saveHistory(deps.db, userId, historyToSave, null);

				return { type: "text", text: responseText };
			}

			// Handle tool calls: provide stub results (Stage 1)
			for (const toolCall of assistantMessage.tool_calls) {
				const toolResultMessage: ChatCompletionMessageParam = {
					role: "tool",
					tool_call_id: toolCall.id,
					content: JSON.stringify({
						status: "not_implemented",
						message: `Tool "${toolCall.function.name}" is not yet implemented. It will be available in a future update.`,
					}),
				};
				messages.push(toolResultMessage);
			}
		}

		// Reached max iterations without a final response
		logger.warn("Agent loop hit max iterations", {
			correlationId,
			userId,
			maxIterations: MAX_ITERATIONS,
		});

		// Save whatever history we have
		const historyToSave = messages.slice(1);
		await deps.saveHistory(deps.db, userId, historyToSave, null);

		return {
			type: "error",
			text: "I was unable to complete your request. Please try a simpler question or rephrase.",
		};
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		logger.error("Agent loop failed", {
			correlationId,
			userId,
			error: errMsg,
		});
		return {
			type: "error",
			text: "Sorry, I encountered an error processing your request. Please try again.",
		};
	}
}
