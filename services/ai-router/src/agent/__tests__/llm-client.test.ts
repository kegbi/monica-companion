import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();
let lastConstructorOpts: Record<string, unknown> = {};

vi.mock("openai", () => {
	return {
		default: class MockOpenAI {
			_opts: unknown;
			chat = {
				completions: {
					create: mockCreate,
				},
			};
			constructor(opts: Record<string, unknown>) {
				this._opts = opts;
				lastConstructorOpts = opts;
			}
		},
	};
});

import { createLlmClient } from "../llm-client.js";

describe("createLlmClient", () => {
	beforeEach(() => {
		mockCreate.mockReset();
	});

	it("creates a client with the given config", () => {
		const client = createLlmClient({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "sk-test-key",
			modelId: "qwen/qwen3-235b-a22b",
		});
		expect(client).toBeDefined();
		expect(client.chatCompletion).toBeTypeOf("function");
	});

	it("calls openai.chat.completions.create with correct params", async () => {
		const messages = [{ role: "user" as const, content: "Hello" }];
		const tools = [
			{
				type: "function" as const,
				function: { name: "test_tool", parameters: {}, description: "test" },
			},
		];

		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: { role: "assistant", content: "Hi there!" },
					finish_reason: "stop",
				},
			],
		});

		const client = createLlmClient({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "sk-test-key",
			modelId: "qwen/qwen3-235b-a22b",
		});

		const result = await client.chatCompletion(messages, tools);
		expect(mockCreate).toHaveBeenCalledTimes(1);

		const callArgs = mockCreate.mock.calls[0][0];
		expect(callArgs.model).toBe("qwen/qwen3-235b-a22b");
		expect(callArgs.messages).toBe(messages);
		expect(callArgs.tools).toBe(tools);
		expect(result.choices[0].message.content).toBe("Hi there!");
	});

	it("applies default 30s timeout on the client constructor", () => {
		createLlmClient({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "sk-test-key",
			modelId: "test-model",
		});

		expect(lastConstructorOpts.timeout).toBe(30_000);
	});

	it("applies custom timeout on the client constructor", () => {
		createLlmClient({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "sk-test-key",
			modelId: "test-model",
			timeoutMs: 15_000,
		});

		expect(lastConstructorOpts.timeout).toBe(15_000);
	});

	it("does not pass timeout in the create() call body", async () => {
		mockCreate.mockResolvedValueOnce({ choices: [] });

		const client = createLlmClient({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "sk-test-key",
			modelId: "test-model",
		});

		await client.chatCompletion([], []);
		const callArgs = mockCreate.mock.calls[0][0];
		expect(callArgs.timeout).toBeUndefined();
	});

	it("propagates errors from the OpenAI SDK", async () => {
		mockCreate.mockRejectedValueOnce(new Error("API error"));

		const client = createLlmClient({
			baseUrl: "https://openrouter.ai/api/v1",
			apiKey: "sk-test-key",
			modelId: "test-model",
		});

		await expect(client.chatCompletion([], [])).rejects.toThrow("API error");
	});
});
