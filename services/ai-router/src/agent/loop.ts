/**
 * Agent loop — the core async loop that drives tool-calling LLM interactions.
 *
 * Replaces the LangGraph StateGraph pipeline. Loads conversation history,
 * runs the LLM with tool definitions, handles tool call interception (mutating
 * tools require confirmation), and persists updated history.
 */

import crypto from "node:crypto";
import { createLogger } from "@monica-companion/observability";
import type { InboundEvent } from "@monica-companion/types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Database } from "../db/connection.js";
import type { GraphResponse } from "../graph/state.js";
import type { ConversationHistoryRow } from "./history-repository.js";
import type { LlmClient } from "./llm-client.js";
import type { PendingToolCall } from "./pending-tool-call.js";
import { isPendingToolCallExpired, PendingToolCallSchema } from "./pending-tool-call.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";
import {
	generateActionDescription,
	MUTATING_TOOLS,
	TOOL_ARG_SCHEMAS,
	TOOL_DEFINITIONS,
} from "./tools.js";

const logger = createLogger("ai-router:agent-loop");

/** Maximum number of LLM call iterations before aborting. */
const MAX_ITERATIONS = 5;

/** Hardcoded version for pending commands (incremented in future stages). */
const PENDING_COMMAND_VERSION = 1;

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
	pendingCommandTtlMinutes: number;
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
 * Parse pendingCommandId from callback data.
 * Format: "action:pendingCommandId:version"
 * Returns null if the format is invalid.
 */
function parseCallbackData(data: string): { pendingCommandId: string; version: number } | null {
	const parts = data.split(":");
	if (parts.length < 3) return null;
	const version = Number(parts[parts.length - 1]);
	if (Number.isNaN(version)) return null;
	const pendingCommandId = parts.slice(1, -1).join(":");
	if (!pendingCommandId) return null;
	return { pendingCommandId, version };
}

/**
 * Handle callback_action events (confirm/cancel/edit).
 */
async function handleCallback(
	deps: AgentLoopDeps,
	userId: string,
	inboundEvent: Extract<InboundEvent, { type: "callback_action" }>,
	correlationId: string,
): Promise<GraphResponse> {
	const history = await deps.getHistory(deps.db, userId);

	if (!history?.pendingToolCall) {
		return {
			type: "text",
			text: "There is no pending action to respond to. You can send me a new message.",
		};
	}

	// Validate pendingToolCall from JSONB
	const parsed = PendingToolCallSchema.safeParse(history.pendingToolCall);
	if (!parsed.success) {
		logger.warn("Invalid pendingToolCall in history, clearing", {
			correlationId,
			userId,
		});
		const existingMessages = Array.isArray(history.messages)
			? (history.messages as ChatCompletionMessageParam[])
			: [];
		await deps.saveHistory(deps.db, userId, existingMessages, null);
		return {
			type: "text",
			text: "There is no pending action to respond to. You can send me a new message.",
		};
	}

	const pendingToolCall = parsed.data;

	// Parse callback data and verify identity (MEDIUM-2)
	const callbackData = parseCallbackData(inboundEvent.data);
	if (!callbackData || callbackData.pendingCommandId !== pendingToolCall.pendingCommandId) {
		logger.warn("Callback identity mismatch or malformed data", {
			correlationId,
			userId,
			callbackPendingCommandId: callbackData?.pendingCommandId ?? "malformed",
			storedPendingCommandId: pendingToolCall.pendingCommandId,
		});
		return {
			type: "text",
			text: "This action is no longer valid. It may have expired or been replaced by a newer action.",
		};
	}

	// TTL enforcement (Step 6)
	if (isPendingToolCallExpired(pendingToolCall, deps.pendingCommandTtlMinutes)) {
		logger.info("Pending tool call expired", {
			correlationId,
			userId,
			pendingCommandId: pendingToolCall.pendingCommandId,
			createdAt: pendingToolCall.createdAt,
		});
		const existingMessages = Array.isArray(history.messages)
			? (history.messages as ChatCompletionMessageParam[])
			: [];
		await deps.saveHistory(deps.db, userId, existingMessages, null);
		return {
			type: "text",
			text: "This action has expired. Please start a new request.",
		};
	}

	const action = inboundEvent.action;
	const existingMessages = Array.isArray(history.messages)
		? (history.messages as ChatCompletionMessageParam[])
		: [];

	if (action === "confirm") {
		return handleConfirm(deps, userId, pendingToolCall, existingMessages, correlationId);
	}
	if (action === "cancel") {
		return handleCancel(deps, userId, pendingToolCall, existingMessages, correlationId);
	}
	if (action === "edit") {
		return handleEdit(deps, userId, pendingToolCall, existingMessages, correlationId);
	}

	// Unknown action: graceful handling
	logger.warn("Unknown callback action", { correlationId, userId, action });
	return {
		type: "text",
		text: "I did not recognize that action. You can send me a new message.",
	};
}

/**
 * Handle confirm callback: append assistant tool-call message + stub tool result,
 * call LLM for success message. (MEDIUM-3: stub execution, real execution in Stage 4)
 */
async function handleConfirm(
	deps: AgentLoopDeps,
	userId: string,
	pendingToolCall: PendingToolCall,
	existingMessages: ChatCompletionMessageParam[],
	correlationId: string,
): Promise<GraphResponse> {
	const systemMessage: ChatCompletionMessageParam = {
		role: "system",
		content: buildAgentSystemPrompt(),
	};

	// Reconstruct: assistant message with tool call + stub tool result
	const assistantMsg = pendingToolCall.assistantMessage as ChatCompletionMessageParam;
	const stubToolResult: ChatCompletionMessageParam = {
		role: "tool",
		tool_call_id: pendingToolCall.toolCallId,
		content: JSON.stringify({
			status: "success",
			message: `Tool "${pendingToolCall.name}" executed successfully (confirmed by user).`,
		}),
	};

	const messages: ChatCompletionMessageParam[] = [
		systemMessage,
		...existingMessages,
		assistantMsg,
		stubToolResult,
	];

	const completion = await deps.llmClient.chatCompletion(messages, TOOL_DEFINITIONS);
	const responseText =
		completion.choices?.[0]?.message?.content ?? "The action was completed successfully.";

	// Save history (without system prompt, with cleared pendingToolCall)
	const historyToSave = [...existingMessages, assistantMsg, stubToolResult];
	if (completion.choices?.[0]?.message) {
		historyToSave.push(completion.choices[0].message as ChatCompletionMessageParam);
	}
	await deps.saveHistory(deps.db, userId, historyToSave, null);

	return { type: "text", text: responseText };
}

/**
 * Handle cancel callback: add cancelled tool result to history, call LLM for cancellation ack.
 */
async function handleCancel(
	deps: AgentLoopDeps,
	userId: string,
	pendingToolCall: PendingToolCall,
	existingMessages: ChatCompletionMessageParam[],
	correlationId: string,
): Promise<GraphResponse> {
	const systemMessage: ChatCompletionMessageParam = {
		role: "system",
		content: buildAgentSystemPrompt(),
	};

	const assistantMsg = pendingToolCall.assistantMessage as ChatCompletionMessageParam;
	const cancelledToolResult: ChatCompletionMessageParam = {
		role: "tool",
		tool_call_id: pendingToolCall.toolCallId,
		content: JSON.stringify({
			status: "cancelled",
			message: `Tool "${pendingToolCall.name}" was cancelled by the user.`,
		}),
	};

	const messages: ChatCompletionMessageParam[] = [
		systemMessage,
		...existingMessages,
		assistantMsg,
		cancelledToolResult,
	];

	const completion = await deps.llmClient.chatCompletion(messages, TOOL_DEFINITIONS);
	const responseText =
		completion.choices?.[0]?.message?.content ?? "The action has been cancelled.";

	const historyToSave = [...existingMessages, assistantMsg, cancelledToolResult];
	if (completion.choices?.[0]?.message) {
		historyToSave.push(completion.choices[0].message as ChatCompletionMessageParam);
	}
	await deps.saveHistory(deps.db, userId, historyToSave, null);

	return { type: "text", text: responseText };
}

/**
 * Handle edit callback: clear pending, add cancelled result, LLM asks what to change.
 */
async function handleEdit(
	deps: AgentLoopDeps,
	userId: string,
	pendingToolCall: PendingToolCall,
	existingMessages: ChatCompletionMessageParam[],
	correlationId: string,
): Promise<GraphResponse> {
	const systemMessage: ChatCompletionMessageParam = {
		role: "system",
		content: buildAgentSystemPrompt(),
	};

	const assistantMsg = pendingToolCall.assistantMessage as ChatCompletionMessageParam;
	const editToolResult: ChatCompletionMessageParam = {
		role: "tool",
		tool_call_id: pendingToolCall.toolCallId,
		content: JSON.stringify({
			status: "edit_requested",
			message: `User wants to edit the "${pendingToolCall.name}" action. Ask what they want to change.`,
		}),
	};

	const messages: ChatCompletionMessageParam[] = [
		systemMessage,
		...existingMessages,
		assistantMsg,
		editToolResult,
	];

	const completion = await deps.llmClient.chatCompletion(messages, TOOL_DEFINITIONS);
	const responseText =
		completion.choices?.[0]?.message?.content ?? "What would you like to change?";

	const historyToSave = [...existingMessages, assistantMsg, editToolResult];
	if (completion.choices?.[0]?.message) {
		historyToSave.push(completion.choices[0].message as ChatCompletionMessageParam);
	}
	await deps.saveHistory(deps.db, userId, historyToSave, null);

	return { type: "text", text: responseText };
}

/**
 * Run the agent loop for a single inbound event.
 *
 * Returns a GraphResponse (type: "text" | "confirmation_prompt" | "error")
 * compatible with the existing /internal/process response contract.
 */
export async function runAgentLoop(
	deps: AgentLoopDeps,
	userId: string,
	inboundEvent: InboundEvent,
	correlationId: string,
): Promise<GraphResponse> {
	try {
		// Handle callback_action
		if (inboundEvent.type === "callback_action") {
			return handleCallback(deps, userId, inboundEvent, correlationId);
		}

		// Load existing conversation history
		const history = await deps.getHistory(deps.db, userId);
		const existingMessages: ChatCompletionMessageParam[] = history?.messages
			? (history.messages as ChatCompletionMessageParam[])
			: [];

		// Step 7: Handle stale pending tool call for new text/voice messages
		let messagesWithStaleHandling = existingMessages;
		if (history?.pendingToolCall) {
			const staleParsed = PendingToolCallSchema.safeParse(history.pendingToolCall);
			if (staleParsed.success) {
				const stalePending = staleParsed.data;
				// Append assistant message + abandoned tool result to history
				const assistantMsg = stalePending.assistantMessage as ChatCompletionMessageParam;
				const abandonedToolResult: ChatCompletionMessageParam = {
					role: "tool",
					tool_call_id: stalePending.toolCallId,
					content: JSON.stringify({
						status: "abandoned",
						message: `Tool "${stalePending.name}" was abandoned because the user sent a new message.`,
					}),
				};
				messagesWithStaleHandling = [...existingMessages, assistantMsg, abandonedToolResult];
				logger.info("Cleared stale pending tool call", {
					correlationId,
					userId,
					pendingCommandId: stalePending.pendingCommandId,
				});
			}
		}

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
			...messagesWithStaleHandling,
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

			// Step 4: Separate read-only vs mutating tool calls
			const toolResults: ChatCompletionMessageParam[] = [];
			let interceptedMutatingTool: {
				toolCall: (typeof assistantMessage.tool_calls)[number];
				parsedArgs: Record<string, unknown>;
			} | null = null;
			let hasIntercepted = false;

			for (const toolCall of assistantMessage.tool_calls) {
				const toolName = toolCall.function.name;

				if (MUTATING_TOOLS.has(toolName)) {
					if (hasIntercepted) {
						// Additional mutating tools after the first get error results (LOW-3)
						toolResults.push({
							role: "tool",
							tool_call_id: toolCall.id,
							content: JSON.stringify({
								status: "error",
								message: `Cannot execute "${toolName}" while another mutating action is pending confirmation. Please try again after the current action is resolved.`,
							}),
						});
						continue;
					}

					// Validate args with Zod
					const schema = TOOL_ARG_SCHEMAS[toolName];
					let parsedArgs: Record<string, unknown>;
					try {
						parsedArgs = JSON.parse(toolCall.function.arguments);
					} catch {
						toolResults.push({
							role: "tool",
							tool_call_id: toolCall.id,
							content: JSON.stringify({
								status: "error",
								message: `Invalid JSON arguments for "${toolName}".`,
							}),
						});
						continue;
					}

					if (schema) {
						const argValidation = schema.safeParse(parsedArgs);
						if (!argValidation.success) {
							toolResults.push({
								role: "tool",
								tool_call_id: toolCall.id,
								content: JSON.stringify({
									status: "error",
									message: `Invalid arguments for "${toolName}": ${argValidation.error.issues.map((i: { message: string }) => i.message).join(", ")}`,
								}),
							});
							continue;
						}
					}

					// Valid mutating tool call — intercept it
					interceptedMutatingTool = { toolCall, parsedArgs };
					hasIntercepted = true;
				} else {
					// Read-only tool: provide stub result (Stage 1 behavior)
					toolResults.push({
						role: "tool",
						tool_call_id: toolCall.id,
						content: JSON.stringify({
							status: "not_implemented",
							message: `Tool "${toolName}" is not yet implemented. It will be available in a future update.`,
						}),
					});
				}
			}

			// If a mutating tool was intercepted, save pending and return confirmation
			if (interceptedMutatingTool) {
				const { toolCall, parsedArgs } = interceptedMutatingTool;
				const pendingCommandId = crypto.randomUUID(); // LOW-1: inline at call site
				const actionDescription = generateActionDescription(toolCall.function.name, parsedArgs);

				const pendingToolCall: PendingToolCall = {
					pendingCommandId,
					name: toolCall.function.name,
					arguments: toolCall.function.arguments,
					toolCallId: toolCall.id,
					actionDescription,
					createdAt: new Date().toISOString(),
					assistantMessage: assistantMessage as unknown as Record<string, unknown>,
				};

				// Add any read-only tool results that were collected before the interception
				for (const tr of toolResults) {
					messages.push(tr);
				}

				// Save history with pending tool call (exclude system prompt)
				const historyToSave = messages.slice(1);
				await deps.saveHistory(deps.db, userId, historyToSave, pendingToolCall);

				return {
					type: "confirmation_prompt",
					text: `Please confirm: ${actionDescription}`,
					pendingCommandId,
					version: PENDING_COMMAND_VERSION,
				};
			}

			// No mutating tool intercepted — add all tool results and continue loop
			for (const tr of toolResults) {
				messages.push(tr);
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
