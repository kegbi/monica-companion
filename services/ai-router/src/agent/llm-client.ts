import OpenAI from "openai";
import type {
	ChatCompletionMessageParam,
	ChatCompletionTool,
} from "openai/resources/chat/completions";

export interface LlmClientConfig {
	baseUrl: string;
	apiKey: string;
	modelId: string;
	timeoutMs?: number;
}

export interface LlmClient {
	chatCompletion(
		messages: ChatCompletionMessageParam[],
		tools: ChatCompletionTool[],
	): Promise<OpenAI.Chat.Completions.ChatCompletion>;
}

/**
 * Creates a thin LLM client wrapping the OpenAI SDK.
 * Supports any OpenAI-compatible API (OpenRouter, vLLM, Ollama, etc.)
 * via configurable baseURL.
 */
export function createLlmClient(config: LlmClientConfig): LlmClient {
	const timeoutMs = config.timeoutMs ?? 30_000;

	const openai = new OpenAI({
		baseURL: config.baseUrl,
		apiKey: config.apiKey,
		timeout: timeoutMs,
	});

	return {
		async chatCompletion(messages, tools) {
			return openai.chat.completions.create({
				model: config.modelId,
				messages,
				tools: tools.length > 0 ? tools : undefined,
			});
		},
	};
}
