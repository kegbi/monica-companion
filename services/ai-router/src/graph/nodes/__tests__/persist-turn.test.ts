/**
 * Tests for the persistTurn graph node.
 *
 * Verifies that compressed turn summaries are persisted to DB,
 * raw utterances are never stored, and errors are handled gracefully.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/api", () => ({
	trace: {
		getTracer: () => ({
			startActiveSpan: (_name: string, fn: (span: unknown) => unknown) =>
				fn({ setAttribute: () => {}, end: () => {} }),
		}),
	},
}));

import type { IntentClassificationResult } from "../../intent-schemas.js";
import { createPersistTurnNode } from "../persist-turn.js";

function makeState(overrides: Record<string, unknown> = {}) {
	return {
		userId: "550e8400-e29b-41d4-a716-446655440000",
		correlationId: "corr-123",
		inboundEvent: {
			type: "text_message" as const,
			userId: "550e8400-e29b-41d4-a716-446655440000",
			sourceRef: "telegram:msg:456",
			correlationId: "corr-123",
			text: "Create a note for Jane about our secret lunch at 555-1234",
		},
		recentTurns: [],
		activePendingCommand: null,
		resolvedContact: null,
		userPreferences: null,
		response: {
			type: "text" as const,
			text: "I'll create a note for Jane about your lunch.",
		},
		intentClassification: {
			intent: "mutating_command",
			detectedLanguage: "en",
			userFacingText: "I'll create a note for Jane about your lunch.",
			commandType: "create_note",
			contactRef: "Jane",
			commandPayload: { body: "our secret lunch at 555-1234" },
			confidence: 0.95,
		} as IntentClassificationResult,
		...overrides,
	};
}

describe("createPersistTurnNode", () => {
	it("inserts a user turn summary with compressed content", async () => {
		const insertTurnSummary = vi.fn().mockResolvedValue({});
		const redactString = vi.fn().mockImplementation((s: string) => s);

		const node = createPersistTurnNode({
			db: {} as any,
			insertTurnSummary,
			redactString,
		});

		await node(makeState());

		// First call should be the user turn
		expect(insertTurnSummary).toHaveBeenCalledWith(
			{},
			expect.objectContaining({
				userId: "550e8400-e29b-41d4-a716-446655440000",
				role: "user",
				correlationId: "corr-123",
			}),
		);

		// User summary should be compressed (not raw utterance)
		const userCall = insertTurnSummary.mock.calls[0][1];
		expect(userCall.summary).toContain("create_note");
		expect(userCall.summary).toContain("Jane");
		// Must NOT contain raw utterance
		expect(userCall.summary).not.toContain("our secret lunch at 555-1234");
	});

	it("inserts an assistant turn summary with compressed content", async () => {
		const insertTurnSummary = vi.fn().mockResolvedValue({});
		const redactString = vi.fn().mockImplementation((s: string) => s);

		const node = createPersistTurnNode({
			db: {} as any,
			insertTurnSummary,
			redactString,
		});

		await node(makeState());

		// Second call should be the assistant turn
		expect(insertTurnSummary).toHaveBeenCalledTimes(2);
		const assistantCall = insertTurnSummary.mock.calls[1][1];
		expect(assistantCall.role).toBe("assistant");
		expect(assistantCall.summary).toContain("text");
		expect(assistantCall.correlationId).toBe("corr-123");
	});

	it("passes summaries through redaction before DB write", async () => {
		const insertTurnSummary = vi.fn().mockResolvedValue({});
		const redactString = vi
			.fn()
			.mockImplementation((s: string) => s.replace(/Jane/g, "[REDACTED]"));

		const node = createPersistTurnNode({
			db: {} as any,
			insertTurnSummary,
			redactString,
		});

		await node(makeState());

		// redactString should be called for each summary
		expect(redactString).toHaveBeenCalledTimes(2);

		// The inserted summaries should have been through redaction
		const userCall = insertTurnSummary.mock.calls[0][1];
		expect(userCall.summary).toContain("[REDACTED]");
	});

	it("returns empty state update", async () => {
		const insertTurnSummary = vi.fn().mockResolvedValue({});
		const redactString = vi.fn().mockImplementation((s: string) => s);

		const node = createPersistTurnNode({
			db: {} as any,
			insertTurnSummary,
			redactString,
		});

		const update = await node(makeState());
		expect(update).toEqual({});
	});

	it("handles DB errors gracefully without failing the graph", async () => {
		const insertTurnSummary = vi.fn().mockRejectedValue(new Error("DB connection lost"));
		const redactString = vi.fn().mockImplementation((s: string) => s);

		const node = createPersistTurnNode({
			db: {} as any,
			insertTurnSummary,
			redactString,
		});

		// Should not throw
		const update = await node(makeState());
		expect(update).toEqual({});
	});

	it("compresses greeting intent correctly", async () => {
		const insertTurnSummary = vi.fn().mockResolvedValue({});
		const redactString = vi.fn().mockImplementation((s: string) => s);

		const node = createPersistTurnNode({
			db: {} as any,
			insertTurnSummary,
			redactString,
		});

		await node(
			makeState({
				intentClassification: {
					intent: "greeting",
					detectedLanguage: "en",
					userFacingText: "Hello!",
					commandType: null,
					contactRef: null,
					commandPayload: null,
					confidence: 0.99,
				},
				response: { type: "text", text: "Hello!" },
			}),
		);

		const userCall = insertTurnSummary.mock.calls[0][1];
		expect(userCall.summary).toContain("greeting");
	});

	it("skips persistence when intentClassification is null", async () => {
		const insertTurnSummary = vi.fn().mockResolvedValue({});
		const redactString = vi.fn().mockImplementation((s: string) => s);

		const node = createPersistTurnNode({
			db: {} as any,
			insertTurnSummary,
			redactString,
		});

		await node(makeState({ intentClassification: null }));
		expect(insertTurnSummary).not.toHaveBeenCalled();
	});
});
