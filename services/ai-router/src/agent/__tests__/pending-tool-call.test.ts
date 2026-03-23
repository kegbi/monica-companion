import { describe, expect, it } from "vitest";
import { isPendingToolCallExpired, PendingToolCallSchema } from "../pending-tool-call.js";

describe("PendingToolCallSchema", () => {
	const validPendingToolCall = {
		pendingCommandId: "cmd-550e8400-e29b-41d4-a716-446655440000",
		name: "create_note",
		arguments: '{"contact_id": 1, "body": "Test note"}',
		toolCallId: "call_abc123",
		actionDescription: 'Create a note for contact 1: "Test note"',
		createdAt: "2026-03-23T12:00:00.000Z",
		assistantMessage: {
			role: "assistant",
			content: null,
			tool_calls: [
				{
					id: "call_abc123",
					type: "function",
					function: { name: "create_note", arguments: '{"contact_id": 1, "body": "Test note"}' },
				},
			],
		},
	};

	it("accepts a valid pending tool call", () => {
		const result = PendingToolCallSchema.safeParse(validPendingToolCall);
		expect(result.success).toBe(true);
	});

	it("requires pendingCommandId", () => {
		const { pendingCommandId: _, ...without } = validPendingToolCall;
		const result = PendingToolCallSchema.safeParse(without);
		expect(result.success).toBe(false);
	});

	it("requires name", () => {
		const { name: _, ...without } = validPendingToolCall;
		const result = PendingToolCallSchema.safeParse(without);
		expect(result.success).toBe(false);
	});

	it("requires arguments as a string", () => {
		const result = PendingToolCallSchema.safeParse({
			...validPendingToolCall,
			arguments: 123,
		});
		expect(result.success).toBe(false);
	});

	it("requires toolCallId", () => {
		const { toolCallId: _, ...without } = validPendingToolCall;
		const result = PendingToolCallSchema.safeParse(without);
		expect(result.success).toBe(false);
	});

	it("requires actionDescription", () => {
		const { actionDescription: _, ...without } = validPendingToolCall;
		const result = PendingToolCallSchema.safeParse(without);
		expect(result.success).toBe(false);
	});

	it("requires createdAt as ISO 8601 string", () => {
		const result = PendingToolCallSchema.safeParse({
			...validPendingToolCall,
			createdAt: "",
		});
		expect(result.success).toBe(false);
	});

	it("requires assistantMessage as an object", () => {
		const result = PendingToolCallSchema.safeParse({
			...validPendingToolCall,
			assistantMessage: "not-an-object",
		});
		expect(result.success).toBe(false);
	});
});

describe("isPendingToolCallExpired", () => {
	it("returns false for a fresh pending tool call (within TTL)", () => {
		const now = new Date();
		const createdAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString(); // 5 min ago
		const pendingToolCall = { createdAt };
		expect(isPendingToolCallExpired(pendingToolCall as any, 30)).toBe(false);
	});

	it("returns true for an expired pending tool call (past TTL)", () => {
		const now = new Date();
		const createdAt = new Date(now.getTime() - 31 * 60 * 1000).toISOString(); // 31 min ago
		const pendingToolCall = { createdAt };
		expect(isPendingToolCallExpired(pendingToolCall as any, 30)).toBe(true);
	});

	it("returns true for exactly expired pending tool call (at TTL boundary)", () => {
		const now = new Date();
		const createdAt = new Date(now.getTime() - 30 * 60 * 1000).toISOString(); // exactly 30 min ago
		const pendingToolCall = { createdAt };
		// At the exact boundary, we consider it expired
		expect(isPendingToolCallExpired(pendingToolCall as any, 30)).toBe(true);
	});

	it("returns false with a 1-minute TTL for a 30-second-old pending tool call", () => {
		const now = new Date();
		const createdAt = new Date(now.getTime() - 30 * 1000).toISOString(); // 30s ago
		const pendingToolCall = { createdAt };
		expect(isPendingToolCallExpired(pendingToolCall as any, 1)).toBe(false);
	});
});
