/**
 * Agent loop — the core async loop that drives tool-calling LLM interactions.
 *
 * Replaces the LangGraph StateGraph pipeline. Loads conversation history,
 * runs the LLM with tool definitions, handles tool call interception (mutating
 * tools require confirmation), and persists updated history.
 */

import crypto from "node:crypto";
import type { ServiceClient } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";
import type { InboundEvent } from "@monica-companion/types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Database } from "../db/connection.js";
import type { SchedulerClient } from "../lib/scheduler-client.js";
import type { ConversationHistoryRow } from "./history-repository.js";
import type { LlmClient } from "./llm-client.js";
import type { PendingToolCall } from "./pending-tool-call.js";
import { isPendingToolCallExpired, PendingToolCallSchema } from "./pending-tool-call.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";
import { executeMutatingTool } from "./tool-handlers/mutating-handlers.js";
import { handleQueryBirthday } from "./tool-handlers/query-birthday.js";
import { handleQueryLastNote } from "./tool-handlers/query-last-note.js";
import { handleQueryPhone } from "./tool-handlers/query-phone.js";
import { handleQueryReminders } from "./tool-handlers/query-reminders.js";
import { handleSearchContacts } from "./tool-handlers/search-contacts.js";
import {
	generateActionDescription,
	MUTATING_TOOLS,
	TOOL_ARG_SCHEMAS,
	TOOL_DEFINITIONS,
} from "./tools.js";
import type { GraphResponse } from "./types.js";

const logger = createLogger("ai-router:agent-loop");

/** Maximum number of LLM call iterations before aborting. */
const MAX_ITERATIONS = 5;

/**
 * Strip tool_calls from an assistant message before persisting.
 * Prevents history corruption when the LLM unexpectedly returns tool_calls
 * in a context where they won't be processed (e.g., post-action acknowledgment).
 */
function stripToolCalls(msg: ChatCompletionMessageParam): ChatCompletionMessageParam {
	if (msg.role === "assistant" && "tool_calls" in msg && msg.tool_calls) {
		const { tool_calls: _, ...rest } = msg;
		return rest as ChatCompletionMessageParam;
	}
	return msg;
}

/**
 * Repair corrupted conversation history by adding synthetic error results
 * for assistant tool_calls that have no matching tool response.
 * This prevents the "tool_call_ids did not have response messages" API error.
 */
function repairHistory(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
	const repaired: ChatCompletionMessageParam[] = [];

	for (let i = 0; i < messages.length; i++) {
		repaired.push(messages[i]);
		const msg = messages[i];

		if (msg.role !== "assistant" || !("tool_calls" in msg) || !msg.tool_calls) continue;

		// Collect IDs of tool_calls that have matching tool results after this message
		const expectedIds = new Set(msg.tool_calls.map((tc) => tc.id));
		for (let j = i + 1; j < messages.length; j++) {
			const next = messages[j];
			if (next.role === "tool" && "tool_call_id" in next && typeof next.tool_call_id === "string") {
				expectedIds.delete(next.tool_call_id);
			}
		}

		// Add synthetic error results for any orphaned tool_call_ids
		for (const id of expectedIds) {
			repaired.push({
				role: "tool",
				tool_call_id: id,
				content: JSON.stringify({
					status: "error",
					message: "Tool call was not completed due to an earlier error.",
				}),
			});
		}
	}

	return repaired;
}

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
	monicaServiceClient: ServiceClient;
	schedulerClient: SchedulerClient;
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
 * Format: "pendingCommandId:version"
 * (The action prefix is stripped by telegram-bridge and sent as a separate
 * field in the InboundEvent, so only pendingCommandId:version arrives here.)
 * Returns null if the format is invalid.
 */
function parseCallbackData(data: string): { pendingCommandId: string; version: number } | null {
	const parts = data.split(":");
	if (parts.length < 2) return null;
	const version = Number(parts[parts.length - 1]);
	if (Number.isNaN(version)) return null;
	const pendingCommandId = parts.slice(0, -1).join(":");
	if (!pendingCommandId) return null;
	return { pendingCommandId, version };
}

/**
 * Scan conversation messages for the most recent search_contacts tool result
 * and return the displayName matching the given contact_id.
 * Returns null if no match is found.
 */
function resolveContactNameFromHistory(
	messages: ChatCompletionMessageParam[],
	parsedArgs: Record<string, unknown>,
): string | null {
	const contactId = parsedArgs.contact_id;
	if (typeof contactId !== "number") return null;

	// Walk messages backwards to find the latest search_contacts result
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "tool" || typeof msg.content !== "string") continue;

		try {
			const parsed = JSON.parse(msg.content);
			if (parsed.status !== "ok" || !Array.isArray(parsed.contacts)) continue;
			const match = parsed.contacts.find((c: { contactId?: number }) => c.contactId === contactId);
			if (match?.displayName) return match.displayName;
		} catch {
			// Not valid JSON — skip
		}
	}
	return null;
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
 * Handle confirm callback: execute the confirmed mutating tool via scheduler,
 * append the result to history, and call LLM for the success/failure message.
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

	// Parse tool arguments from pending tool call
	let parsedArgs: Record<string, unknown>;
	try {
		parsedArgs = JSON.parse(pendingToolCall.arguments);
	} catch {
		parsedArgs = {};
	}

	// Execute the mutating tool via the scheduler
	const handlerResult = await executeMutatingTool({
		toolName: pendingToolCall.name,
		args: parsedArgs,
		userId,
		correlationId,
		pendingCommandId: pendingToolCall.pendingCommandId,
		schedulerClient: deps.schedulerClient,
		monicaServiceClient: deps.monicaServiceClient,
	});

	// Build tool result from handler response
	const assistantMsg = pendingToolCall.assistantMessage as ChatCompletionMessageParam;
	const toolResult: ChatCompletionMessageParam = {
		role: "tool",
		tool_call_id: pendingToolCall.toolCallId,
		content:
			handlerResult.status === "success"
				? JSON.stringify({
						status: "success",
						executionId: handlerResult.executionId,
						message: "Action executed successfully.",
						...(handlerResult.result ? { result: handlerResult.result } : {}),
					})
				: JSON.stringify({
						status: "error",
						message: handlerResult.message,
					}),
	};

	// Re-append collected read-only tool results from the same LLM turn
	const collectedResults = (pendingToolCall.collectedToolResults ??
		[]) as ChatCompletionMessageParam[];

	const messages: ChatCompletionMessageParam[] = [
		systemMessage,
		...existingMessages,
		assistantMsg,
		...collectedResults,
		toolResult,
	];

	// Post-confirm agent loop: execute read-only follow-ups, intercept mutating
	// tools for confirmation. If a new confirmation is returned, the loop already
	// saved history with the new pendingToolCall — don't overwrite it.
	const result = await runPostConfirmLoop(deps, messages, userId, correlationId);

	if (result.type !== "confirmation_prompt") {
		// Final text response — save history with cleared pendingToolCall
		const historyToSave = messages.slice(1);
		await deps.saveHistory(deps.db, userId, historyToSave, null);
	}

	return result;
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
	const collectedResults = (pendingToolCall.collectedToolResults ??
		[]) as ChatCompletionMessageParam[];
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
		...collectedResults,
		cancelledToolResult,
	];

	// Pass tools so the LLM can generate clean responses; stripToolCalls prevents history corruption
	const completion = await deps.llmClient.chatCompletion(messages, TOOL_DEFINITIONS);
	const responseText =
		completion.choices?.[0]?.message?.content ?? "The action has been cancelled.";

	const historyToSave = [
		...existingMessages,
		assistantMsg,
		...collectedResults,
		cancelledToolResult,
	];
	if (completion.choices?.[0]?.message) {
		historyToSave.push(stripToolCalls(completion.choices[0].message as ChatCompletionMessageParam));
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
	const collectedResults = (pendingToolCall.collectedToolResults ??
		[]) as ChatCompletionMessageParam[];
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
		...collectedResults,
		editToolResult,
	];

	// Pass tools so the LLM can generate clean responses; stripToolCalls prevents history corruption
	const completion = await deps.llmClient.chatCompletion(messages, TOOL_DEFINITIONS);
	const responseText =
		completion.choices?.[0]?.message?.content ?? "What would you like to change?";

	const historyToSave = [...existingMessages, assistantMsg, ...collectedResults, editToolResult];
	if (completion.choices?.[0]?.message) {
		historyToSave.push(stripToolCalls(completion.choices[0].message as ChatCompletionMessageParam));
	}
	await deps.saveHistory(deps.db, userId, historyToSave, null);

	return { type: "text", text: responseText };
}

/** Maximum follow-up iterations after a confirmed action. */
const MAX_POST_CONFIRM_ITERATIONS = 3;

/**
 * Post-confirm agent loop: after the user-confirmed tool is executed, the LLM
 * may want to make follow-up tool calls. Read-only tools are auto-executed;
 * mutating tools are intercepted for a new confirmation prompt.
 *
 * Mutates `messages` in place (appends assistant + tool result messages).
 */
async function runPostConfirmLoop(
	deps: AgentLoopDeps,
	messages: ChatCompletionMessageParam[],
	userId: string,
	correlationId: string,
): Promise<GraphResponse> {
	for (let i = 0; i < MAX_POST_CONFIRM_ITERATIONS; i++) {
		const completion = await deps.llmClient.chatCompletion(messages, TOOL_DEFINITIONS);
		const choice = completion.choices?.[0];

		if (!choice?.message) {
			return { type: "text", text: "The action was completed successfully." };
		}

		const msg = choice.message;
		const preAssistantLen = messages.length;
		messages.push(msg as ChatCompletionMessageParam);

		// No tool calls → final text response
		if (!msg.tool_calls || msg.tool_calls.length === 0) {
			return { type: "text", text: msg.content ?? "The action was completed successfully." };
		}

		// Process tool calls: execute read-only, intercept mutating for confirmation
		const toolResults: ChatCompletionMessageParam[] = [];
		let interceptedMutating: {
			toolCall: (typeof msg.tool_calls)[number];
			parsedArgs: Record<string, unknown>;
		} | null = null;

		for (const toolCall of msg.tool_calls) {
			const toolName = toolCall.function.name;

			if (MUTATING_TOOLS.has(toolName)) {
				// Intercept for confirmation — same as main agent loop
				if (interceptedMutating) {
					toolResults.push({
						role: "tool",
						tool_call_id: toolCall.id,
						content: JSON.stringify({
							status: "error",
							message: `Cannot execute "${toolName}" while another mutating action is pending confirmation.`,
						}),
					});
					continue;
				}

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

				const schema = TOOL_ARG_SCHEMAS[toolName];
				if (schema) {
					const validation = schema.safeParse(parsedArgs);
					if (!validation.success) {
						toolResults.push({
							role: "tool",
							tool_call_id: toolCall.id,
							content: JSON.stringify({
								status: "error",
								message: `Invalid arguments for "${toolName}": ${validation.error.issues.map((i: { message: string }) => i.message).join(", ")}`,
							}),
						});
						continue;
					}
				}

				interceptedMutating = { toolCall, parsedArgs };
			} else {
				const result = await executeReadOnlyTool(toolName, toolCall, deps, userId, correlationId);
				toolResults.push(result);
			}
		}

		// If a mutating tool was intercepted, save pending and return confirmation
		if (interceptedMutating) {
			const { toolCall, parsedArgs } = interceptedMutating;
			const pendingCommandId = crypto.randomUUID();

			// Include toolResults when resolving contact name — search_contacts results
			// from the same LLM turn are in toolResults, not yet in messages.
			const contactName = resolveContactNameFromHistory([...messages, ...toolResults], parsedArgs);
			const enrichedArgs = contactName ? { ...parsedArgs, contactName } : parsedArgs;
			const actionDescription = generateActionDescription(toolCall.function.name, enrichedArgs);

			const pendingToolCall: PendingToolCall = {
				pendingCommandId,
				name: toolCall.function.name,
				arguments: toolCall.function.arguments,
				toolCallId: toolCall.id,
				actionDescription,
				createdAt: new Date().toISOString(),
				assistantMessage: msg as unknown as Record<string, unknown>,
				collectedToolResults:
					toolResults.length > 0
						? toolResults.map((tr) => tr as unknown as Record<string, unknown>)
						: undefined,
			};

			// Save history up to (but excluding) the new assistant message
			const historyToSave = messages.slice(1, preAssistantLen);
			await deps.saveHistory(deps.db, userId, historyToSave, pendingToolCall);

			return {
				type: "confirmation_prompt",
				text: `Please confirm: ${actionDescription}`,
				pendingCommandId,
				version: PENDING_COMMAND_VERSION,
			};
		}

		// Only read-only tools — add results and continue loop
		for (const tr of toolResults) {
			messages.push(tr);
		}
	}

	// Reached iteration limit — return best available text
	const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
	const fallbackText =
		(lastAssistant && "content" in lastAssistant ? (lastAssistant.content as string) : null) ??
		"The action was completed successfully.";
	return { type: "text", text: fallbackText };
}

/**
 * Generic read-only tool dispatch helper (M4 fix: avoid duplicated
 * JSON-parse-validate-dispatch pattern for each read-only tool).
 *
 * Parses JSON arguments, validates with Zod schema, and dispatches
 * to the appropriate handler. Returns a ChatCompletionMessageParam
 * containing the tool result.
 */
async function executeReadOnlyTool(
	toolName: string,
	toolCall: { id: string; function: { arguments: string } },
	deps: AgentLoopDeps,
	userId: string,
	correlationId: string,
): Promise<ChatCompletionMessageParam> {
	// Step 1: Parse JSON arguments
	let parsedArgs: Record<string, unknown>;
	try {
		parsedArgs = JSON.parse(toolCall.function.arguments);
	} catch {
		return {
			role: "tool",
			tool_call_id: toolCall.id,
			content: JSON.stringify({
				status: "error",
				message: `Invalid JSON arguments for "${toolName}".`,
			}),
		};
	}

	// Step 2: Validate with Zod schema
	const schema = TOOL_ARG_SCHEMAS[toolName];
	if (schema) {
		const validation = schema.safeParse(parsedArgs);
		if (!validation.success) {
			return {
				role: "tool",
				tool_call_id: toolCall.id,
				content: JSON.stringify({
					status: "error",
					message: `Invalid arguments for "${toolName}": ${validation.error.issues.map((i: { message: string }) => i.message).join(", ")}`,
				}),
			};
		}
	}

	// Step 3: Dispatch to handler
	let handlerResult: unknown;

	switch (toolName) {
		case "search_contacts":
			handlerResult = await handleSearchContacts({
				query: parsedArgs.query as string,
				serviceClient: deps.monicaServiceClient,
				userId,
				correlationId,
			});
			break;

		case "query_birthday":
			handlerResult = await handleQueryBirthday({
				contactId: parsedArgs.contact_id as number,
				serviceClient: deps.monicaServiceClient,
				userId,
				correlationId,
			});
			break;

		case "query_phone":
			handlerResult = await handleQueryPhone({
				contactId: parsedArgs.contact_id as number,
				serviceClient: deps.monicaServiceClient,
				userId,
				correlationId,
			});
			break;

		case "query_last_note":
			handlerResult = await handleQueryLastNote({
				contactId: parsedArgs.contact_id as number,
				serviceClient: deps.monicaServiceClient,
				userId,
				correlationId,
			});
			break;

		case "query_reminders":
			handlerResult = await handleQueryReminders({
				serviceClient: deps.monicaServiceClient,
				userId,
				correlationId,
				days: (parsedArgs.days as number | undefined) ?? 1,
			});
			break;

		default:
			handlerResult = {
				status: "error",
				message: `Unknown tool "${toolName}".`,
			};
	}

	return {
		role: "tool",
		tool_call_id: toolCall.id,
		content: JSON.stringify(handlerResult),
	};
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
				// Append assistant message + collected read-only results + abandoned tool result to history
				const assistantMsg = stalePending.assistantMessage as ChatCompletionMessageParam;
				const staleCollected = (stalePending.collectedToolResults ??
					[]) as ChatCompletionMessageParam[];
				const abandonedToolResult: ChatCompletionMessageParam = {
					role: "tool",
					tool_call_id: stalePending.toolCallId,
					content: JSON.stringify({
						status: "abandoned",
						message: `Tool "${stalePending.name}" was abandoned because the user sent a new message.`,
					}),
				};
				messagesWithStaleHandling = [
					...existingMessages,
					assistantMsg,
					...staleCollected,
					abandonedToolResult,
				];
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
		let consecutiveToolErrors = 0;
		while (iteration < MAX_ITERATIONS) {
			iteration++;

			const completion = await deps.llmClient.chatCompletion(messages, TOOL_DEFINITIONS);

			if (!completion.choices || completion.choices.length === 0) {
				logger.warn("LLM returned empty choices", { correlationId, userId, iteration });
				return { type: "error", text: "I was unable to process your request. Please try again." };
			}

			const choice = completion.choices[0];
			const assistantMessage = choice.message;

			// Track position before adding assistant message (used to trim history for pending state)
			const preAssistantLen = messages.length;

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
					// Read-only tools: validate args + dispatch to handler
					const readOnlyResult = await executeReadOnlyTool(
						toolName,
						toolCall,
						deps,
						userId,
						correlationId,
					);
					toolResults.push(readOnlyResult);
				}
			}

			// If a mutating tool was intercepted, save pending and return confirmation
			if (interceptedMutatingTool) {
				const { toolCall, parsedArgs } = interceptedMutatingTool;
				const pendingCommandId = crypto.randomUUID(); // LOW-1: inline at call site

				// Enrich parsedArgs with contact display name from prior search_contacts results
				const contactName = resolveContactNameFromHistory(messages, parsedArgs);
				const enrichedArgs = contactName ? { ...parsedArgs, contactName } : parsedArgs;
				const actionDescription = generateActionDescription(toolCall.function.name, enrichedArgs);

				const pendingToolCall: PendingToolCall = {
					pendingCommandId,
					name: toolCall.function.name,
					arguments: toolCall.function.arguments,
					toolCallId: toolCall.id,
					actionDescription,
					createdAt: new Date().toISOString(),
					assistantMessage: assistantMessage as unknown as Record<string, unknown>,
					// Preserve read-only tool results from the same turn so they can be
					// re-appended alongside the assistant message on confirm/cancel/edit.
					collectedToolResults:
						toolResults.length > 0
							? toolResults.map((tr) => tr as unknown as Record<string, unknown>)
							: undefined,
				};

				// Save history WITHOUT the assistant message or its tool results.
				// The assistant message is preserved in pendingToolCall.assistantMessage
				// and will be re-appended on confirm/cancel/edit with all tool results.
				const historyToSave = messages.slice(1, preAssistantLen);
				await deps.saveHistory(deps.db, userId, historyToSave, pendingToolCall);

				return {
					type: "confirmation_prompt",
					text: `Please confirm: ${actionDescription}`,
					pendingCommandId,
					version: PENDING_COMMAND_VERSION,
				};
			}

			// No mutating tool intercepted — add all tool results and continue loop
			const allToolsFailed =
				toolResults.length > 0 &&
				toolResults.every((tr) => {
					const content = "content" in tr && typeof tr.content === "string" ? tr.content : "";
					return content.includes('"status":"error"');
				});

			if (allToolsFailed) {
				consecutiveToolErrors++;
			} else {
				consecutiveToolErrors = 0;
			}

			// If tools keep failing, stop looping — the LLM will just retry the same call
			if (consecutiveToolErrors >= 2) {
				logger.warn("Agent loop stopped: consecutive tool errors", {
					correlationId,
					userId,
					iteration,
					consecutiveToolErrors,
				});

				// Save history and return a graceful text response
				for (const tr of toolResults) {
					messages.push(tr);
				}
				const historyToSave = messages.slice(1);
				await deps.saveHistory(deps.db, userId, historyToSave, null);

				return {
					type: "text",
					text: "I'm having trouble connecting to your contact database right now. Please try again later.",
				};
			}

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

		// Attempt to repair corrupted history so the next request doesn't hit the same error
		try {
			const history = await deps.getHistory(deps.db, userId);
			if (history?.messages && Array.isArray(history.messages)) {
				const msgs = history.messages as ChatCompletionMessageParam[];
				const repaired = repairHistory(msgs);
				if (repaired.length !== msgs.length) {
					await deps.saveHistory(deps.db, userId, repaired, history.pendingToolCall);
					logger.info("Repaired corrupted conversation history", { correlationId, userId });
				}
			}
		} catch {
			logger.warn("Failed to repair conversation history", { correlationId, userId });
		}

		return {
			type: "error",
			text: "Sorry, I encountered an error processing your request. Please try again.",
		};
	}
}
