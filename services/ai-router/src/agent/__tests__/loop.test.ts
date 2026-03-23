import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLoopDeps } from "../loop.js";

// Mock openai to avoid import issues
vi.mock("openai", () => ({
	default: class MockOpenAI {
		constructor() {}
		chat = { completions: { create: vi.fn() } };
	},
}));

import type { GraphResponse } from "../../graph/state.js";
import { runAgentLoop } from "../loop.js";

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
		...overrides,
	};
}

const userId = "550e8400-e29b-41d4-a716-446655440000";
const correlationId = "corr-test-1";

describe("runAgentLoop", () => {
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

	it("handles read-only tool calls by providing stub results and continuing the loop", async () => {
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
							content: "I found Jane for you!",
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
		expect(result.text).toBe("I found Jane for you!");
		expect(chatCompletion).toHaveBeenCalledTimes(2);
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
		actionDescription: "Create a note for contact 1",
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
	it("on confirm, appends stub tool result to history, calls LLM, and returns text", async () => {
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
			data: `confirm:cmd-aaa-bbb-ccc:1`,
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		expect(result.text).toContain("Done");
		expect(chatCompletion).toHaveBeenCalledTimes(1);

		// History should have been saved with null pendingToolCall (cleared)
		const saveCall = (deps.saveHistory as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(saveCall[3]).toBeNull();
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
			data: `cancel:cmd-aaa-bbb-ccc:1`,
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
			data: `edit:cmd-aaa-bbb-ccc:1`,
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
			data: "confirm:cmd-WRONG-ID:1", // wrong pendingCommandId
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
			data: "unknown_action:cmd-aaa-bbb-ccc:1",
		};

		const result = await runAgentLoop(deps, userId, event, correlationId);
		expect(result.type).toBe("text");
		// Should not crash, graceful handling
		expect(result.text).toBeTruthy();
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
			data: `confirm:cmd-aaa-bbb-ccc:1`,
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
			data: `confirm:cmd-aaa-bbb-ccc:1`,
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
