import { describe, expect, it, vi } from "vitest";

const mockWithStructuredOutput = vi.fn().mockReturnValue({ invoke: vi.fn() });

const { ChatOpenAISpy } = vi.hoisted(() => {
	const ChatOpenAISpy = vi.fn().mockImplementation(function (this: any) {
		this.withStructuredOutput = mockWithStructuredOutput;
	});
	return { ChatOpenAISpy };
});

vi.mock("@langchain/openai", () => ({
	ChatOpenAI: ChatOpenAISpy,
}));

import { createIntentClassifier } from "../llm.js";

describe("createIntentClassifier", () => {
	it("returns an object with an invoke method", () => {
		const classifier = createIntentClassifier({ openaiApiKey: "sk-test-key" });
		expect(classifier).toBeDefined();
		expect(typeof classifier.invoke).toBe("function");
	});

	it("creates ChatOpenAI with correct model configuration", () => {
		createIntentClassifier({ openaiApiKey: "sk-test-key" });
		expect(ChatOpenAISpy).toHaveBeenCalledWith(
			expect.objectContaining({
				modelName: "gpt-5.4-mini",
				openAIApiKey: "sk-test-key",
				timeout: 30000,
			}),
		);
	});

	it("passes reasoning_effort in model kwargs", () => {
		createIntentClassifier({ openaiApiKey: "sk-test-key" });
		const callArgs = ChatOpenAISpy.mock.calls[0][0];
		expect(callArgs.modelKwargs).toEqual(
			expect.objectContaining({
				reasoning_effort: "medium",
			}),
		);
	});

	it("binds structured output with the IntentClassificationResultSchema", () => {
		createIntentClassifier({ openaiApiKey: "sk-test-key" });
		expect(mockWithStructuredOutput).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				name: "intent_classification",
			}),
		);
	});
});
