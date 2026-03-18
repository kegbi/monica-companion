import { describe, expect, it, vi } from "vitest";
import type { IntentClassificationResult } from "../../intent-schemas.js";
import type { PendingCommandRef, TurnSummary } from "../../state.js";
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

	// --- New: conversation context passed to LLM ---

	it("includes conversation history in system prompt when recentTurns exist", async () => {
		const classifier = makeMockClassifier(mutatingResult);
		const node = createClassifyIntentNode(classifier);

		const recentTurns: TurnSummary[] = [
			{
				role: "user",
				summary: "Requested create_note for Jane",
				createdAt: "2026-01-01T00:00:00Z",
				correlationId: "corr-1",
			},
		];

		await node(makeState({ recentTurns }));
		const systemMessage = classifier.invoke.mock.calls[0][0][0];
		expect(systemMessage.content).toContain("Conversation History");
		expect(systemMessage.content).toContain("Requested create_note for Jane");
	});

	it("includes active pending command in system prompt when present", async () => {
		const classifier = makeMockClassifier(mutatingResult);
		const node = createClassifyIntentNode(classifier);

		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-123",
			version: 1,
			status: "draft",
			commandType: "create_note",
		};

		await node(makeState({ activePendingCommand }));
		const systemMessage = classifier.invoke.mock.calls[0][0][0];
		expect(systemMessage.content).toContain("Active Pending Command");
		expect(systemMessage.content).toContain("create_note");
	});

	it("constructs synthetic message for callback_action with active pending command", async () => {
		const classifier = makeMockClassifier({
			intent: "clarification_response",
			detectedLanguage: "en",
			userFacingText: "Selected Jane Doe for the note.",
			commandType: "create_note",
			contactRef: "Jane Doe",
			commandPayload: { body: "lunch" },
			confidence: 0.9,
		});
		const node = createClassifyIntentNode(classifier);

		const activePendingCommand: PendingCommandRef = {
			pendingCommandId: "cmd-123",
			version: 1,
			status: "draft",
			commandType: "create_note",
		};

		const state = makeState({
			activePendingCommand,
			inboundEvent: {
				type: "callback_action" as const,
				userId: "550e8400-e29b-41d4-a716-446655440000",
				sourceRef: "telegram:msg:101",
				correlationId: "corr-123",
				action: "disambiguate",
				data: "jane-doe-id",
			},
		});

		const update = await node(state);
		// When there's an active pending command AND a callback, it SHOULD call the LLM
		expect(classifier.invoke).toHaveBeenCalled();
		// The synthetic message should describe the callback action
		const humanMessage = classifier.invoke.mock.calls[0][0][1];
		expect(humanMessage.content).toContain("disambiguate");
		expect(humanMessage.content).toContain("jane-doe-id");
	});

	it("does not call LLM for callback_action without active pending command", async () => {
		const classifier = makeMockClassifier(greetingResult);
		const node = createClassifyIntentNode(classifier);

		const state = makeState({
			activePendingCommand: null,
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
		expect(classifier.invoke).not.toHaveBeenCalled();
		expect(update.intentClassification!.intent).toBe("clarification_response");
	});
});
