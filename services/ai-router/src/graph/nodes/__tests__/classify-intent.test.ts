import { describe, expect, it, vi } from "vitest";
import type { IntentClassificationResult } from "../../intent-schemas.js";
import { createClassifyIntentNode } from "../classify-intent.js";

function makeMockClassifier(result: IntentClassificationResult) {
	return {
		invoke: vi.fn().mockResolvedValue(result),
	};
}

function makeState(overrides: Record<string, unknown> = {}) {
	return {
		userId: "550e8400-e29b-41d4-a716-446655440000",
		correlationId: "corr-123",
		inboundEvent: {
			type: "text_message" as const,
			userId: "550e8400-e29b-41d4-a716-446655440000",
			sourceRef: "telegram:msg:456",
			correlationId: "corr-123",
			text: "Create a note for Jane about our lunch",
		},
		recentTurns: [],
		activePendingCommand: null,
		resolvedContact: null,
		userPreferences: null,
		response: null,
		intentClassification: null,
		...overrides,
	};
}

const mutatingResult: IntentClassificationResult = {
	intent: "mutating_command",
	detectedLanguage: "en",
	userFacingText: "I'll create a note for Jane about your lunch.",
	commandType: "create_note",
	contactRef: "Jane",
	commandPayload: { body: "our lunch" },
	confidence: 0.95,
};

const greetingResult: IntentClassificationResult = {
	intent: "greeting",
	detectedLanguage: "en",
	userFacingText: "Hello! How can I help you today?",
	commandType: null,
	contactRef: null,
	commandPayload: null,
	confidence: 0.99,
};

const outOfScopeResult: IntentClassificationResult = {
	intent: "out_of_scope",
	detectedLanguage: "en",
	userFacingText: "I can only help with personal CRM tasks.",
	commandType: null,
	contactRef: null,
	commandPayload: null,
	confidence: 0.92,
};

describe("createClassifyIntentNode", () => {
	it("classifies a text_message and returns intentClassification in state update", async () => {
		const classifier = makeMockClassifier(mutatingResult);
		const node = createClassifyIntentNode(classifier);

		const update = await node(makeState());
		expect(update.intentClassification).toEqual(mutatingResult);
	});

	it("sends system prompt as first message and user text as second", async () => {
		const classifier = makeMockClassifier(greetingResult);
		const node = createClassifyIntentNode(classifier);

		await node(makeState());
		const invokeArgs = classifier.invoke.mock.calls[0][0];
		expect(invokeArgs).toHaveLength(2);
		expect(invokeArgs[0].constructor.name).toBe("SystemMessage");
		expect(invokeArgs[1].constructor.name).toBe("HumanMessage");
	});

	it("uses transcribedText for voice_message events", async () => {
		const classifier = makeMockClassifier(mutatingResult);
		const node = createClassifyIntentNode(classifier);

		const state = makeState({
			inboundEvent: {
				type: "voice_message" as const,
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "telegram:msg:789",
				correlationId: "corr-123",
				transcribedText: "Set a reminder for Jane",
			},
		});

		await node(state);
		const invokeArgs = classifier.invoke.mock.calls[0][0];
		expect(invokeArgs[1].content).toBe("Set a reminder for Jane");
	});

	it("returns clarification_response placeholder for callback_action events", async () => {
		const classifier = makeMockClassifier(greetingResult);
		const node = createClassifyIntentNode(classifier);

		const state = makeState({
			inboundEvent: {
				type: "callback_action" as const,
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "telegram:msg:101",
				correlationId: "corr-123",
				action: "confirm",
				data: "cmd-123",
			},
		});

		const update = await node(state);
		expect(update.intentClassification).toBeDefined();
		expect(update.intentClassification!.intent).toBe("clarification_response");
		// LLM should NOT be called for callback_action
		expect(classifier.invoke).not.toHaveBeenCalled();
	});

	it("returns out_of_scope with error text when LLM call fails", async () => {
		const classifier = {
			invoke: vi.fn().mockRejectedValue(new Error("LLM timeout")),
		};
		const node = createClassifyIntentNode(classifier);

		const update = await node(makeState());
		expect(update.intentClassification).toBeDefined();
		expect(update.intentClassification!.intent).toBe("out_of_scope");
		expect(update.intentClassification!.userFacingText).toBeTruthy();
		expect(update.intentClassification!.confidence).toBe(0);
	});

	it("classifies a greeting intent", async () => {
		const classifier = makeMockClassifier(greetingResult);
		const node = createClassifyIntentNode(classifier);

		const state = makeState({
			inboundEvent: {
				type: "text_message" as const,
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "telegram:msg:456",
				correlationId: "corr-123",
				text: "Hello!",
			},
		});

		const update = await node(state);
		expect(update.intentClassification!.intent).toBe("greeting");
	});

	it("classifies an out_of_scope intent", async () => {
		const classifier = makeMockClassifier(outOfScopeResult);
		const node = createClassifyIntentNode(classifier);

		const state = makeState({
			inboundEvent: {
				type: "text_message" as const,
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "telegram:msg:456",
				correlationId: "corr-123",
				text: "What is the weather?",
			},
		});

		const update = await node(state);
		expect(update.intentClassification!.intent).toBe("out_of_scope");
	});
});
