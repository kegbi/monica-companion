import type { ServiceClient } from "@monica-companion/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLoopDeps } from "../loop.js";

// Mock openai to avoid import issues
vi.mock("openai", () => ({
	default: class MockOpenAI {
		chat = { completions: { create: vi.fn() } };
	},
}));

// Mock tool handlers
vi.mock("../tool-handlers/search-contacts.js", () => ({
	handleSearchContacts: vi.fn(),
}));
vi.mock("../tool-handlers/query-birthday.js", () => ({
	handleQueryBirthday: vi.fn(),
}));
vi.mock("../tool-handlers/query-phone.js", () => ({
	handleQueryPhone: vi.fn(),
}));
vi.mock("../tool-handlers/query-last-note.js", () => ({
	handleQueryLastNote: vi.fn(),
}));
vi.mock("../tool-handlers/mutating-handlers.js", () => ({
	executeMutatingTool: vi.fn(),
}));

import { runAgentLoop } from "../loop.js";
import { executeMutatingTool } from "../tool-handlers/mutating-handlers.js";
import { handleQueryBirthday } from "../tool-handlers/query-birthday.js";
import { handleQueryLastNote } from "../tool-handlers/query-last-note.js";
import { handleQueryPhone } from "../tool-handlers/query-phone.js";
import { handleSearchContacts } from "../tool-handlers/search-contacts.js";

const mockedHandleSearchContacts = vi.mocked(handleSearchContacts);
const mockedHandleQueryBirthday = vi.mocked(handleQueryBirthday);
const mockedHandleQueryPhone = vi.mocked(handleQueryPhone);
const mockedHandleQueryLastNote = vi.mocked(handleQueryLastNote);
const mockedExecuteMutatingTool = vi.mocked(executeMutatingTool);

function createMockServiceClient(): ServiceClient {
	return {
		fetch: vi.fn(),
	};
}

function createMockDeps(overrides?: Partial<AgentLoopDeps>): AgentLoopDeps {
	return {
		llmClient: {
			chatCompletion: vi.fn().mockResolvedValue({
				choices: [
					{
						message: {
							role: "assistant",
							content: "Hello! How can I help you?",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			}),
		},
		db: {} as never,
		getHistory: vi.fn().mockResolvedValue(null),
		saveHistory: vi.fn().mockResolvedValue(undefined),
		pendingCommandTtlMinutes: 30,
		monicaServiceClient: createMockServiceClient(),
		schedulerClient: {
			execute: vi.fn().mockResolvedValue({ executionId: "exec-1", status: "queued" }),
		},
		...overrides,
	};
}

const userId = "550e8400-e29b-41d4-a716-446655440000";
const correlationId = "corr-test-1";

describe("runAgentLoop", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns a text response for a simple text_message", async () => {
		const deps = createMockDeps();
		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:1",
			correlationId,
			text: "Hello",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(result.text).toBe("Hello! How can I help you?");
	});

	it("returns a text response for a voice_message", async () => {
		const deps = createMockDeps();
		const event = {
			type: "voice_message" as const,
			userId,
			sourceRef: "telegram:msg:2",
			correlationId,
			transcribedText: "What is Jane's birthday?",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(result.text).toBeTruthy();
	});

	it("returns text response for callback_action without pendingToolCall", async () => {
		const deps = createMockDeps({
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [],
				pendingToolCall: null,
				updatedAt: new Date(),
			}),
		});
		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:3",
			correlationId,
			action: "confirm",
			data: "cmd-123:1",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(result.text).toBeTruthy();
	});

	it("loads existing history and includes it in LLM messages", async () => {
		const existingMessages = [
			{ role: "user", content: "Hi" },
			{ role: "assistant", content: "Hello!" },
		];
		const deps = createMockDeps({
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: existingMessages,
				pendingToolCall: null,
				updatedAt: new Date(),
			}),
		});
		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:4",
			correlationId,
			text: "Tell me more",
		};

		await runAgentLoop(deps, userId, event, correlationId);
		const chatCall = (deps.llmClient.chatCompletion as ReturnType<typeof vi.fn>).mock.calls[0];
		const messages = chatCall[0];
		// Should have system + existing history + new user message
		expect(messages.length).toBeGreaterThanOrEqual(4); // system + hi + hello + tell me more
	});

	it("saves history after processing", async () => {
		const deps = createMockDeps();
		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:5",
			correlationId,
			text: "Hello",
		};

		await runAgentLoop(deps, userId, event, correlationId);
		expect(deps.saveHistory).toHaveBeenCalledTimes(1);
	});

	it("invokes search_contacts handler and returns results to LLM", async () => {
		mockedHandleSearchContacts.mockResolvedValue({
			status: "ok",
			contacts: [
				{
					contactId: 1,
					displayName: "Jane Doe",
					aliases: ["Jane", "Doe"],
					relationshipLabels: ["friend"],
					birthdate: "1990-05-15",
					matchReason: "exact_display_name",
				},
			],
		});

		const chatCompletion = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_1",
									type: "function",
									function: {
										name: "search_contacts",
										arguments: '{"query": "Jane"}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: "I found Jane Doe for you!",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
		});

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:6",
			correlationId,
			text: "Find Jane",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(result.text).toBe("I found Jane Doe for you!");
		expect(chatCompletion).toHaveBeenCalledTimes(2);

		// Verify the handler was called with correct parameters
		expect(mockedHandleSearchContacts).toHaveBeenCalledWith({
			query: "Jane",
			serviceClient: deps.monicaServiceClient,
			userId,
			correlationId,
		});

		// Verify the tool result was passed to the second LLM call
		const secondCall = chatCompletion.mock.calls[1];
		const messages = secondCall[0];
		const toolResultMsg = messages.find(
			(m: { role: string; tool_call_id?: string }) =>
				m.role === "tool" && m.tool_call_id === "call_1",
		);
		expect(toolResultMsg).toBeTruthy();
		expect(toolResultMsg.content).toContain("Jane Doe");
	});

	it("returns validation error to LLM when search_contacts args are invalid", async () => {
		const chatCompletion = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_bad",
									type: "function",
									function: {
										name: "search_contacts",
										arguments: '{"query": ""}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: "Please provide a search term.",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
		});

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:6b",
			correlationId,
			text: "Search for...",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(chatCompletion).toHaveBeenCalledTimes(2);
		// Handler should NOT have been called due to validation failure
		expect(mockedHandleSearchContacts).not.toHaveBeenCalled();
	});

	it("dispatches query_birthday to the handler instead of stub", async () => {
		mockedHandleQueryBirthday.mockResolvedValue({
			status: "ok",
			birthday: "1990-05-15",
			isYearUnknown: false,
			contactId: 1,
		});

		const chatCompletion = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_qb",
									type: "function",
									function: {
										name: "query_birthday",
										arguments: '{"contact_id": 1}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: "Jane's birthday is May 15, 1990.",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
		});

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:6c",
			correlationId,
			text: "What is Jane's birthday?",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(chatCompletion).toHaveBeenCalledTimes(2);
		expect(mockedHandleQueryBirthday).toHaveBeenCalledWith({
			contactId: 1,
			serviceClient: deps.monicaServiceClient,
			userId,
			correlationId,
		});

		// Verify handler result was sent to LLM (not "not_implemented")
		const secondCall = chatCompletion.mock.calls[1];
		const messages = secondCall[0];
		const toolResultMsg = messages.find(
			(m: { role: string; tool_call_id?: string }) =>
				m.role === "tool" && m.tool_call_id === "call_qb",
		);
		expect(toolResultMsg).toBeTruthy();
		expect(toolResultMsg.content).toContain("1990-05-15");
		expect(toolResultMsg.content).not.toContain("not_implemented");
	});

	it("returns validation error to LLM when query_birthday args are invalid", async () => {
		const chatCompletion = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_qb_bad",
									type: "function",
									function: {
										name: "query_birthday",
										arguments: '{"contact_id": -1}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: "Please provide a valid contact ID.",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps = createMockDeps({ llmClient: { chatCompletion } });

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:6d",
			correlationId,
			text: "What is someone's birthday?",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(chatCompletion).toHaveBeenCalledTimes(2);
		// Handler should NOT have been called due to validation failure
		expect(mockedHandleQueryBirthday).not.toHaveBeenCalled();
	});

	it("dispatches query_phone to the handler", async () => {
		mockedHandleQueryPhone.mockResolvedValue({
			status: "ok",
			phones: [{ value: "+1-555-0142", typeName: "mobile" }],
			contactId: 42,
		});

		const chatCompletion = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_qp",
									type: "function",
									function: {
										name: "query_phone",
										arguments: '{"contact_id": 42}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: "The phone number is +1-555-0142.",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
		});

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:6f",
			correlationId,
			text: "What is contact 42's phone number?",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(chatCompletion).toHaveBeenCalledTimes(2);
		expect(mockedHandleQueryPhone).toHaveBeenCalledWith({
			contactId: 42,
			serviceClient: deps.monicaServiceClient,
			userId,
			correlationId,
		});

		// Verify handler result was sent to LLM
		const secondCall = chatCompletion.mock.calls[1];
		const messages = secondCall[0];
		const toolResultMsg = messages.find(
			(m: { role: string; tool_call_id?: string }) =>
				m.role === "tool" && m.tool_call_id === "call_qp",
		);
		expect(toolResultMsg).toBeTruthy();
		expect(toolResultMsg.content).toContain("+1-555-0142");
		expect(toolResultMsg.content).not.toContain("not_implemented");
	});

	it("dispatches query_last_note to the handler", async () => {
		mockedHandleQueryLastNote.mockResolvedValue({
			status: "ok",
			note: {
				body: "Had lunch with Sarah at the new restaurant.",
				createdAt: "2026-03-20T12:00:00Z",
			},
			contactId: 77,
		});

		const chatCompletion = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_qln",
									type: "function",
									function: {
										name: "query_last_note",
										arguments: '{"contact_id": 77}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: "The last note was about having lunch at a restaurant.",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
		});

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:6g",
			correlationId,
			text: "What is the last note for contact 77?",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(chatCompletion).toHaveBeenCalledTimes(2);
		expect(mockedHandleQueryLastNote).toHaveBeenCalledWith({
			contactId: 77,
			serviceClient: deps.monicaServiceClient,
			userId,
			correlationId,
		});

		// Verify handler result was sent to LLM
		const secondCall = chatCompletion.mock.calls[1];
		const messages = secondCall[0];
		const toolResultMsg = messages.find(
			(m: { role: string; tool_call_id?: string }) =>
				m.role === "tool" && m.tool_call_id === "call_qln",
		);
		expect(toolResultMsg).toBeTruthy();
		expect(toolResultMsg.content).toContain("Had lunch with Sarah");
		expect(toolResultMsg.content).not.toContain("not_implemented");
	});

	it("returns validation error to LLM when query_phone args are invalid", async () => {
		const chatCompletion = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_qp_bad",
									type: "function",
									function: {
										name: "query_phone",
										arguments: '{"contact_id": -1}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: "Please provide a valid contact ID.",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps = createMockDeps({ llmClient: { chatCompletion } });

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:6h",
			correlationId,
			text: "What is the phone for invalid contact?",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(chatCompletion).toHaveBeenCalledTimes(2);
		expect(mockedHandleQueryPhone).not.toHaveBeenCalled();
	});

	it("returns validation error to LLM when query_last_note args are invalid", async () => {
		const chatCompletion = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_qln_bad",
									type: "function",
									function: {
										name: "query_last_note",
										arguments: "{}",
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: "I need a valid contact ID to look up notes.",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps = createMockDeps({ llmClient: { chatCompletion } });

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:6i",
			correlationId,
			text: "What is the last note?",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(chatCompletion).toHaveBeenCalledTimes(2);
		expect(mockedHandleQueryLastNote).not.toHaveBeenCalled();
	});

	it("returns error for truly unknown tools", async () => {
		const chatCompletion = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_unknown",
									type: "function",
									function: {
										name: "nonexistent_tool",
										arguments: "{}",
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: "I cannot do that.",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps = createMockDeps({ llmClient: { chatCompletion } });

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:6e",
			correlationId,
			text: "Do something impossible",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");

		const secondCall = chatCompletion.mock.calls[1];
		const messages = secondCall[0];
		const toolResultMsg = messages.find(
			(m: { role: string; tool_call_id?: string }) =>
				m.role === "tool" && m.tool_call_id === "call_unknown",
		);
		expect(toolResultMsg).toBeTruthy();
		expect(toolResultMsg.content).toContain("Unknown tool");
	});

	it("caps at 5 iterations and returns graceful fallback", async () => {
		const chatCompletion = vi.fn().mockResolvedValue({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_n",
								type: "function",
								function: {
									name: "search_contacts",
									arguments: '{"query": "test"}',
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
		});

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:7",
			correlationId,
			text: "Search forever",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("error");
		expect(result.text).toBeTruthy();
		expect(chatCompletion).toHaveBeenCalledTimes(5);
	});

	it("returns error response when LLM throws", async () => {
		const deps = createMockDeps({
			llmClient: {
				chatCompletion: vi.fn().mockRejectedValue(new Error("LLM timeout")),
			},
		});
		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:8",
			correlationId,
			text: "Hello",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("error");
		expect(result.text).toBeTruthy();
	});

	it("returns error response when LLM returns empty choices", async () => {
		const deps = createMockDeps({
			llmClient: {
				chatCompletion: vi.fn().mockResolvedValue({ choices: [] }),
			},
		});
		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:9",
			correlationId,
			text: "Hello",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("error");
		expect(result.text).toBeTruthy();
	});

	it("extracts text from text_message events", async () => {
		const deps = createMockDeps();
		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:10",
			correlationId,
			text: "My specific message",
		};

		await runAgentLoop(deps, userId, event, correlationId);
		const chatCall = (deps.llmClient.chatCompletion as ReturnType<typeof vi.fn>).mock.calls[0];
		const messages = chatCall[0];
		const userMsg = messages.find((m: { role: string; content: string }) => m.role === "user");
		expect(userMsg.content).toBe("My specific message");
	});

	it("extracts text from voice_message events", async () => {
		const deps = createMockDeps();
		const event = {
			type: "voice_message" as const,
			userId,
			sourceRef: "telegram:msg:11",
			correlationId,
			transcribedText: "Voice transcription text",
		};

		await runAgentLoop(deps, userId, event, correlationId);
		const chatCall = (deps.llmClient.chatCompletion as ReturnType<typeof vi.fn>).mock.calls[0];
		const messages = chatCall[0];
		const userMsg = messages.find((m: { role: string; content: string }) => m.role === "user");
		expect(userMsg.content).toBe("Voice transcription text");
	});
});

// --- Step 4: Mutating tool interception tests ---

describe("mutating tool interception", () => {
	it("returns confirmation_prompt when LLM calls a mutating tool with valid args", async () => {
		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_mut_1",
								type: "function",
								function: {
									name: "create_note",
									arguments: '{"contact_id": 1, "body": "Had coffee today"}',
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		});

		const deps = createMockDeps({ llmClient: { chatCompletion } });
		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:20",
			correlationId,
			text: "Add a note to contact 1: Had coffee today",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("confirmation_prompt");
		expect(result.text).toBeTruthy();
		expect(result.pendingCommandId).toBeTruthy();
		expect(result.version).toBe(1);
	});

	it("saves pendingToolCall when intercepting a mutating tool call", async () => {
		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_mut_2",
								type: "function",
								function: {
									name: "create_contact",
									arguments: '{"first_name": "Jane", "last_name": "Doe"}',
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		});

		const deps = createMockDeps({ llmClient: { chatCompletion } });
		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:21",
			correlationId,
			text: "Create a new contact Jane Doe",
		};

		await runAgentLoop(deps, userId, event, correlationId);

		// saveHistory should have been called with a non-null pendingToolCall
		expect(deps.saveHistory).toHaveBeenCalledTimes(1);
		const saveCall = (deps.saveHistory as ReturnType<typeof vi.fn>).mock.calls[0];
		const savedPendingToolCall = saveCall[3];
		expect(savedPendingToolCall).not.toBeNull();
		expect(savedPendingToolCall.name).toBe("create_contact");
		expect(savedPendingToolCall.pendingCommandId).toBeTruthy();
		expect(savedPendingToolCall.toolCallId).toBe("call_mut_2");
		expect(savedPendingToolCall.assistantMessage).toBeTruthy();
	});

	it("confirmation prompt shows contact name from search_contacts results", async () => {
		// Mock search_contacts to return a contact with displayName
		mockedHandleSearchContacts.mockResolvedValueOnce({
			status: "ok",
			contacts: [
				{
					contactId: 683113,
					displayName: "Elena Yuryevna",
					aliases: [],
					relationshipLabels: ["mother"],
					birthdate: null,
					matchReason: "name",
				},
			],
		});

		// LLM iteration 1: calls search_contacts
		// LLM iteration 2: calls create_note with the found contact_id
		const chatCompletion = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_search_1",
									type: "function",
									function: {
										name: "search_contacts",
										arguments: '{"query": "mum"}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_note_1",
									type: "function",
									function: {
										name: "create_note",
										arguments: '{"contact_id": 683113, "body": "went to the park"}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			});

		const deps = createMockDeps({ llmClient: { chatCompletion } });
		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:name-test",
			correlationId,
			text: "Add a note to mum: went to the park",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("confirmation_prompt");
		expect(result.text).toContain("Elena Yuryevna");
		expect(result.text).not.toContain("683113");
	});

	it("returns error tool result and continues loop when mutating tool args are invalid", async () => {
		const chatCompletion = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_bad_args",
									type: "function",
									function: {
										name: "create_note",
										arguments: '{"contact_id": 1}', // missing required "body"
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: "I need the note body to proceed.",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps = createMockDeps({ llmClient: { chatCompletion } });
		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:22",
			correlationId,
			text: "Add a note to contact 1",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		// Loop should continue and produce a text response (not a confirmation)
		expect(result.type).toBe("text");
		expect(chatCompletion).toHaveBeenCalledTimes(2);
	});

	it("handles mixed read-only and mutating tool calls: stubs read-only, intercepts first mutating, errors rest", async () => {
		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_ro_1",
								type: "function",
								function: {
									name: "search_contacts",
									arguments: '{"query": "Jane"}',
								},
							},
							{
								id: "call_mut_a",
								type: "function",
								function: {
									name: "create_note",
									arguments: '{"contact_id": 1, "body": "Note A"}',
								},
							},
							{
								id: "call_mut_b",
								type: "function",
								function: {
									name: "create_note",
									arguments: '{"contact_id": 2, "body": "Note B"}',
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		});

		const deps = createMockDeps({ llmClient: { chatCompletion } });
		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:23",
			correlationId,
			text: "Search Jane and create two notes",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("confirmation_prompt");
		// pendingToolCall should be for the first mutating tool
		const saveCall = (deps.saveHistory as ReturnType<typeof vi.fn>).mock.calls[0];
		const savedPendingToolCall = saveCall[3];
		expect(savedPendingToolCall.toolCallId).toBe("call_mut_a");
	});
});

// --- Step 5: Confirm/cancel/edit callback handling ---

function makePendingToolCall(overrides?: Record<string, unknown>) {
	return {
		pendingCommandId: "cmd-aaa-bbb-ccc",
		name: "create_note",
		arguments: '{"contact_id": 1, "body": "Test note"}',
		toolCallId: "call_abc123",
		actionDescription: 'Create a note for contact 1: "Test note"',
		createdAt: new Date().toISOString(),
		assistantMessage: {
			role: "assistant",
			content: null,
			tool_calls: [
				{
					id: "call_abc123",
					type: "function",
					function: {
						name: "create_note",
						arguments: '{"contact_id": 1, "body": "Test note"}',
					},
				},
			],
		},
		...overrides,
	};
}

describe("callback handling — confirm", () => {
	it("on confirm, calls executeMutatingTool, then LLM, and returns text", async () => {
		mockedExecuteMutatingTool.mockResolvedValue({
			status: "success",
			executionId: "exec-456",
		});

		const pending = makePendingToolCall();
		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: "Done! I created the note for contact 1.",
						tool_calls: undefined,
					},
					finish_reason: "stop",
				},
			],
		});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [{ role: "user", content: "Create note for contact 1" }],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:30",
			correlationId,
			action: "confirm",
			data: `cmd-aaa-bbb-ccc:1`,
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(result.text).toContain("Done");
		expect(chatCompletion).toHaveBeenCalledTimes(1);

		// executeMutatingTool should have been called with correct params
		expect(mockedExecuteMutatingTool).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "create_note",
				userId,
				correlationId,
				pendingCommandId: "cmd-aaa-bbb-ccc",
			}),
		);

		// Tool result passed to LLM should contain "success"
		const llmCallMessages = chatCompletion.mock.calls[0][0];
		const toolResultMsg = llmCallMessages.find(
			(m: { role: string; tool_call_id?: string }) =>
				m.role === "tool" && m.tool_call_id === "call_abc123",
		);
		expect(toolResultMsg).toBeTruthy();
		expect(toolResultMsg.content).toContain("success");

		// History should have been saved with null pendingToolCall (cleared)
		const saveCall = (deps.saveHistory as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(saveCall[3]).toBeNull();
	});

	it("on confirm with scheduler error, still calls LLM with error result", async () => {
		mockedExecuteMutatingTool.mockResolvedValue({
			status: "error",
			message: "scheduler timeout",
		});

		const pending = makePendingToolCall();
		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: "Sorry, the action failed. Please try again.",
						tool_calls: undefined,
					},
					finish_reason: "stop",
				},
			],
		});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [{ role: "user", content: "Create note" }],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:30b",
			correlationId,
			action: "confirm",
			data: `cmd-aaa-bbb-ccc:1`,
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(chatCompletion).toHaveBeenCalledTimes(1);

		// Tool result should contain error
		const llmCallMessages = chatCompletion.mock.calls[0][0];
		const toolResultMsg = llmCallMessages.find(
			(m: { role: string; tool_call_id?: string }) =>
				m.role === "tool" && m.tool_call_id === "call_abc123",
		);
		expect(toolResultMsg).toBeTruthy();
		expect(toolResultMsg.content).toContain("error");
	});
});

describe("callback handling — cancel", () => {
	it("on cancel, clears pendingToolCall, calls LLM for cancellation ack", async () => {
		const pending = makePendingToolCall();
		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: "OK, I cancelled the note creation.",
						tool_calls: undefined,
					},
					finish_reason: "stop",
				},
			],
		});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [{ role: "user", content: "Create note" }],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:31",
			correlationId,
			action: "cancel",
			data: `cmd-aaa-bbb-ccc:1`,
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(chatCompletion).toHaveBeenCalledTimes(1);

		// pendingToolCall should be cleared
		const saveCall = (deps.saveHistory as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(saveCall[3]).toBeNull();
	});
});

describe("callback handling — edit", () => {
	it("on edit, clears pendingToolCall, calls LLM to ask what to change", async () => {
		const pending = makePendingToolCall();
		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: "What would you like to change about the note?",
						tool_calls: undefined,
					},
					finish_reason: "stop",
				},
			],
		});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [{ role: "user", content: "Create note" }],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:32",
			correlationId,
			action: "edit",
			data: `cmd-aaa-bbb-ccc:1`,
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(chatCompletion).toHaveBeenCalledTimes(1);
	});
});

// --- Step 5 MEDIUM-2: Callback identity verification ---

describe("callback identity verification", () => {
	it("rejects callback with mismatched pendingCommandId", async () => {
		const pending = makePendingToolCall({ pendingCommandId: "cmd-aaa-bbb-ccc" });

		const deps = createMockDeps({
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:40",
			correlationId,
			action: "confirm",
			data: "cmd-WRONG-ID:1", // wrong pendingCommandId
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(result.text).toMatch(/stale|outdated|no longer valid|expired/i);
	});

	it("rejects callback with malformed data field", async () => {
		const pending = makePendingToolCall();

		const deps = createMockDeps({
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:41",
			correlationId,
			action: "confirm",
			data: "malformed-no-colons", // malformed
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(result.text).toMatch(/stale|outdated|no longer valid|invalid|expired/i);
	});

	it("rejects callback with unknown action", async () => {
		const pending = makePendingToolCall();

		const deps = createMockDeps({
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:42",
			correlationId,
			action: "unknown_action",
			data: "cmd-aaa-bbb-ccc:1",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		// Should not crash, graceful handling
		expect(result.text).toBeTruthy();
	});
});

describe("callback data with real UUID format", () => {
	it("accepts UUID-format pendingCommandId from telegram-bridge (pendingCommandId:version)", async () => {
		const uuid = "89dbf8b1-0341-40fd-8628-5bc62a75a6e3";
		const pending = makePendingToolCall({ pendingCommandId: uuid });

		mockedExecuteMutatingTool.mockResolvedValue({
			status: "success",
			executionId: "exec-uuid-1",
		});

		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: "Done! Note created.",
						tool_calls: undefined,
					},
					finish_reason: "stop",
				},
			],
		});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [{ role: "user", content: "Create note" }],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:uuid-test",
			correlationId,
			action: "confirm",
			data: `${uuid}:1`,
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(result.text).toContain("Done");
		expect(mockedExecuteMutatingTool).toHaveBeenCalledWith(
			expect.objectContaining({ pendingCommandId: uuid }),
		);
	});
});

// --- Step 6: TTL enforcement ---

describe("TTL enforcement", () => {
	it("rejects callback for expired pending tool call (past TTL)", async () => {
		const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
		const pending = makePendingToolCall({ createdAt: thirtyOneMinutesAgo });

		const deps = createMockDeps({
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:50",
			correlationId,
			action: "confirm",
			data: `cmd-aaa-bbb-ccc:1`,
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(result.text).toMatch(/expired|timed out|no longer valid/i);
	});

	it("clears expired pendingToolCall from history on TTL rejection", async () => {
		const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
		const pending = makePendingToolCall({ createdAt: thirtyOneMinutesAgo });

		const deps = createMockDeps({
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:51",
			correlationId,
			action: "confirm",
			data: `cmd-aaa-bbb-ccc:1`,
		};

		await runAgentLoop(deps, userId, event, correlationId);

		// Should have saved with null pendingToolCall (cleared)
		expect(deps.saveHistory).toHaveBeenCalledTimes(1);
		const saveCall = (deps.saveHistory as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(saveCall[3]).toBeNull();
	});
});

// --- Step 7: Stale pending tool call handling ---

describe("stale pending tool call handling", () => {
	it("clears stale pendingToolCall when new text message arrives and adds abandoned result to history", async () => {
		const pending = makePendingToolCall();
		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: "OK, I dropped the previous action. How can I help?",
						tool_calls: undefined,
					},
					finish_reason: "stop",
				},
			],
		});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [{ role: "user", content: "Create note for contact 1" }],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:60",
			correlationId,
			text: "Never mind, what is the weather?",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");

		// History should be saved with null pendingToolCall
		const saveCall = (deps.saveHistory as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(saveCall[3]).toBeNull();
	});

	it("clears stale pendingToolCall when new voice message arrives", async () => {
		const pending = makePendingToolCall();
		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: "Previous action dropped. What can I do?",
						tool_calls: undefined,
					},
					finish_reason: "stop",
				},
			],
		});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [{ role: "user", content: "Create note" }],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "voice_message" as const,
			userId,
			sourceRef: "telegram:msg:61",
			correlationId,
			transcribedText: "Something completely different",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");

		const saveCall = (deps.saveHistory as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(saveCall[3]).toBeNull();
	});

	it("includes assistant message and abandoned tool result in history when clearing stale pending", async () => {
		const pending = makePendingToolCall();
		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: "Got it, dropping the note. What else?",
						tool_calls: undefined,
					},
					finish_reason: "stop",
				},
			],
		});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [{ role: "user", content: "Create note" }],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:62",
			correlationId,
			text: "Do something else",
		};

		await runAgentLoop(deps, userId, event, correlationId);

		// Check the messages sent to the LLM include the abandoned tool call context
		const chatCall = (chatCompletion as ReturnType<typeof vi.fn>).mock.calls[0];
		const messages = chatCall[0];
		// Should contain: system, existing history, assistant message from pending, tool result (abandoned), new user message
		const toolResultMsg = messages.find(
			(m: { role: string; tool_call_id?: string }) =>
				m.role === "tool" && m.tool_call_id === "call_abc123",
		);
		expect(toolResultMsg).toBeTruthy();
		expect(toolResultMsg.content).toContain("abandoned");
	});
});

describe("post-action LLM call — history safety", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("on confirm, processes follow-up tool_calls and saves clean history", async () => {
		mockedExecuteMutatingTool.mockResolvedValueOnce({
			status: "success",
			executionId: "exec-790",
		});
		mockedHandleSearchContacts.mockResolvedValueOnce({
			status: "ok",
			contacts: [{ contactId: 1, displayName: "Test" }],
		});

		const pending = makePendingToolCall();
		const chatCompletion = vi
			.fn()
			// First post-confirm LLM call: returns a follow-up read-only tool call
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_followup",
									type: "function",
									function: { name: "search_contacts", arguments: '{"query":"test"}' },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			// Second post-confirm LLM call: final text response
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: "Note created for Test.",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [{ role: "user", content: "Create note" }],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:71",
			correlationId,
			action: "confirm",
			data: "cmd-aaa-bbb-ccc:1",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(result.text).toContain("Note created");

		// Saved history should end with a text-only assistant message (no orphaned tool_calls)
		const saveCall = (deps.saveHistory as ReturnType<typeof vi.fn>).mock.calls[0];
		const savedMessages = saveCall[2]; // args: (db, userId, messages, pendingToolCall)
		const lastMsg = savedMessages[savedMessages.length - 1];
		expect(lastMsg.role).toBe("assistant");
		expect(lastMsg.tool_calls).toBeUndefined();

		// The follow-up tool was processed
		expect(mockedHandleSearchContacts).toHaveBeenCalled();
	});
});

describe("corrupted history recovery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("repairs history when agent loop fails due to orphaned tool_calls", async () => {
		// Simulate corrupted history: assistant message with tool_calls but no tool result
		const corruptedMessages = [
			{ role: "user", content: "Create contact Hottabych" },
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_orphaned",
						type: "function",
						function: { name: "search_contacts", arguments: '{"query":"info"}' },
					},
				],
			},
		];

		const chatCompletion = vi
			.fn()
			.mockRejectedValue(
				new Error(
					"400 An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: call_orphaned",
				),
			);

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: corruptedMessages,
				pendingToolCall: null,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "text_message" as const,
			userId,
			sourceRef: "telegram:msg:80",
			correlationId,
			text: "Give all info on Hottabych",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("error");

		// saveHistory should have been called to repair the corrupted history
		const saveCalls = (deps.saveHistory as ReturnType<typeof vi.fn>).mock.calls;
		expect(saveCalls.length).toBeGreaterThanOrEqual(1);

		// The repaired history should have synthetic tool results for orphaned tool_calls
		const repairedMessages = saveCalls[0][2]; // args: (db, userId, messages, pendingToolCall)
		const toolResult = repairedMessages.find(
			(m: { role: string; tool_call_id?: string }) =>
				m.role === "tool" && m.tool_call_id === "call_orphaned",
		);
		expect(toolResult).toBeTruthy();
	});
});

describe("post-confirm follow-up tool execution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("intercepts follow-up mutating tools for confirmation instead of auto-executing", async () => {
		mockedExecuteMutatingTool.mockResolvedValueOnce({
			status: "success",
			executionId: "exec-create",
		});

		const pending = makePendingToolCall({
			name: "create_contact",
			arguments: '{"first_name": "Hottabych"}',
			assistantMessage: {
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_abc123",
						type: "function",
						function: {
							name: "create_contact",
							arguments: '{"first_name": "Hottabych"}',
						},
					},
				],
			},
		});

		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_birthday",
								type: "function",
								function: {
									name: "update_contact_birthday",
									arguments: '{"contact_id": 42, "date": "1994-09-14"}',
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [{ role: "user", content: "Create contact Hottabych with birthday 14.09.1994" }],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:90",
			correlationId,
			action: "confirm",
			data: "cmd-aaa-bbb-ccc:1",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);

		// Should return a NEW confirmation prompt for the birthday update
		expect(result.type).toBe("confirmation_prompt");
		expect(result.text).toContain("birthday");
		expect(result.pendingCommandId).toBeTruthy();

		// executeMutatingTool called only once (for create_contact)
		expect(mockedExecuteMutatingTool).toHaveBeenCalledTimes(1);
		expect(mockedExecuteMutatingTool).toHaveBeenCalledWith(
			expect.objectContaining({ toolName: "create_contact" }),
		);

		// LLM called only once (post-confirm, returned the birthday tool call)
		expect(chatCompletion).toHaveBeenCalledTimes(1);

		// New pending tool call saved for birthday
		const saveCall = (deps.saveHistory as ReturnType<typeof vi.fn>).mock.calls[0];
		const savedPending = saveCall[3];
		expect(savedPending).toBeTruthy();
		expect(savedPending.name).toBe("update_contact_birthday");
	});

	it("auto-executes read-only tools in post-confirm flow", async () => {
		mockedExecuteMutatingTool.mockResolvedValueOnce({
			status: "success",
			executionId: "exec-create",
		});
		mockedHandleSearchContacts.mockResolvedValueOnce({
			status: "ok",
			contacts: [{ contactId: 42, displayName: "Hottabych" }],
		});

		const pending = makePendingToolCall({
			name: "create_contact",
			arguments: '{"first_name": "Hottabych"}',
			assistantMessage: {
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_abc123",
						type: "function",
						function: {
							name: "create_contact",
							arguments: '{"first_name": "Hottabych"}',
						},
					},
				],
			},
		});

		const chatCompletion = vi
			.fn()
			// First LLM call: wants to search_contacts to verify
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_search",
									type: "function",
									function: {
										name: "search_contacts",
										arguments: '{"query": "Hottabych"}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			})
			// Second LLM call: final text
			.mockResolvedValueOnce({
				choices: [
					{
						message: {
							role: "assistant",
							content: "Contact Hottabych created successfully!",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [{ role: "user", content: "Create contact Hottabych" }],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:91",
			correlationId,
			action: "confirm",
			data: "cmd-aaa-bbb-ccc:1",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(result.text).toContain("Hottabych");

		// search_contacts should have been called as read-only follow-up
		expect(mockedHandleSearchContacts).toHaveBeenCalled();
	});

	it("create_contact with birthday_date passes birthdate to scheduler in a single call", async () => {
		mockedExecuteMutatingTool.mockResolvedValueOnce({
			status: "success",
			executionId: "exec-create",
			result: { contactId: 42, displayName: "Hottabych" },
		});

		const pending = makePendingToolCall({
			name: "create_contact",
			arguments: '{"first_name": "Hottabych", "birthday_date": "1994-09-14"}',
			assistantMessage: {
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_abc123",
						type: "function",
						function: {
							name: "create_contact",
							arguments: '{"first_name": "Hottabych", "birthday_date": "1994-09-14"}',
						},
					},
				],
			},
		});

		const chatCompletion = vi.fn().mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: "Created contact Hottabych with birthday September 14, 1994.",
						tool_calls: undefined,
					},
					finish_reason: "stop",
				},
			],
		});

		const deps = createMockDeps({
			llmClient: { chatCompletion },
			getHistory: vi.fn().mockResolvedValue({
				id: "hist-1",
				userId,
				messages: [{ role: "user", content: "Create contact Hottabych with birthday 14.09.1994" }],
				pendingToolCall: pending,
				updatedAt: new Date(),
			}),
		});

		const event = {
			type: "callback_action" as const,
			userId,
			sourceRef: "telegram:msg:92",
			correlationId,
			action: "confirm",
			data: "cmd-aaa-bbb-ccc:1",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);

		expect(result.type).toBe("text");
		expect(result.text).toContain("Hottabych");

		// executeMutatingTool called once with birthday_date in args
		expect(mockedExecuteMutatingTool).toHaveBeenCalledTimes(1);
		expect(mockedExecuteMutatingTool).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "create_contact",
				args: expect.objectContaining({ birthday_date: "1994-09-14" }),
			}),
		);
	});
});
