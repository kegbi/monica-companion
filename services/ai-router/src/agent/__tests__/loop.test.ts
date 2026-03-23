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

	it("handles tool calls by providing stub results and continuing the loop", async () => {
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
