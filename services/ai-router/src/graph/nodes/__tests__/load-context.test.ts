/**
 * Tests for the loadContext graph node.
 *
 * Verifies that the node loads recent turn summaries and active pending
 * command from the database into graph state.
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

import type { TurnSummary } from "../../state.js";
import { createLoadContextNode } from "../load-context.js";

function makeState(overrides: Record<string, unknown> = {}) {
	return {
		userId: "550e8400-e29b-41d4-a716-446655440000",
		correlationId: "corr-123",
		inboundEvent: {
			type: "text_message" as const,
			userId: "550e8400-e29b-41d4-a716-446655440000",
			sourceRef: "telegram:msg:456",
			correlationId: "corr-123",
			text: "Hello",
		},
		recentTurns: [],
		activePendingCommand: null,
		contactResolution: null,
		contactSummariesCache: null,
		userPreferences: null,
		response: null,
		intentClassification: null,
		narrowingContext: null,
		unresolvedContactRef: null,
		actionOutcome: null,
		...overrides,
	};
}

describe("createLoadContextNode", () => {
	it("loads recent turns from the repository into state", async () => {
		const mockTurns: TurnSummary[] = [
			{
				role: "user",
				summary: "Requested create_note for Jane",
				createdAt: "2026-01-01T00:00:00Z",
				correlationId: "corr-1",
			},
			{
				role: "assistant",
				summary: "Responded with confirmation prompt",
				createdAt: "2026-01-01T00:01:00Z",
				correlationId: "corr-1",
			},
		];

		const getRecentTurns = vi.fn().mockResolvedValue(mockTurns);
		const getActivePendingCommandForUser = vi.fn().mockResolvedValue(null);

		const node = createLoadContextNode({
			db: {} as any,
			maxTurns: 10,
			getRecentTurns,
			getActivePendingCommandForUser,
		});

		const update = await node(makeState());
		expect(update.recentTurns).toEqual(mockTurns);
		expect(getRecentTurns).toHaveBeenCalledWith({}, "550e8400-e29b-41d4-a716-446655440000", 10);
	});

	it("returns empty turns when none exist in DB", async () => {
		const getRecentTurns = vi.fn().mockResolvedValue([]);
		const getActivePendingCommandForUser = vi.fn().mockResolvedValue(null);

		const node = createLoadContextNode({
			db: {} as any,
			maxTurns: 10,
			getRecentTurns,
			getActivePendingCommandForUser,
		});

		const update = await node(makeState());
		expect(update.recentTurns).toEqual([]);
	});

	it("loads active pending command into state", async () => {
		const mockCommand = {
			id: "cmd-123",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { body: "lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "telegram:msg:100",
			correlationId: "corr-0",
			createdAt: new Date(),
			updatedAt: new Date(),
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
		};

		const getRecentTurns = vi.fn().mockResolvedValue([]);
		const getActivePendingCommandForUser = vi.fn().mockResolvedValue(mockCommand);

		const node = createLoadContextNode({
			db: {} as any,
			maxTurns: 10,
			getRecentTurns,
			getActivePendingCommandForUser,
		});

		const update = await node(makeState());
		expect(update.activePendingCommand).toEqual({
			pendingCommandId: "cmd-123",
			version: 1,
			status: "draft",
			commandType: "create_note",
		});
	});

	it("sets activePendingCommand to null when no active command exists", async () => {
		const getRecentTurns = vi.fn().mockResolvedValue([]);
		const getActivePendingCommandForUser = vi.fn().mockResolvedValue(null);

		const node = createLoadContextNode({
			db: {} as any,
			maxTurns: 10,
			getRecentTurns,
			getActivePendingCommandForUser,
		});

		const update = await node(makeState());
		expect(update.activePendingCommand).toBeNull();
	});

	it("loads narrowingContext from active pending command when valid", async () => {
		const narrowingContext = {
			originalContactRef: "mom",
			clarifications: ["Elena"],
			round: 1,
			narrowingCandidateIds: [10, 20],
		};

		const mockCommand = {
			id: "cmd-123",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { body: "lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "telegram:msg:100",
			correlationId: "corr-0",
			createdAt: new Date(),
			updatedAt: new Date(),
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			narrowingContext,
		};

		const getRecentTurns = vi.fn().mockResolvedValue([]);
		const getActivePendingCommandForUser = vi.fn().mockResolvedValue(mockCommand);

		const node = createLoadContextNode({
			db: {} as any,
			maxTurns: 10,
			getRecentTurns,
			getActivePendingCommandForUser,
		});

		const update = await node(makeState());
		expect(update.narrowingContext).toEqual(narrowingContext);
	});

	it("sets narrowingContext to null when active command has no narrowingContext", async () => {
		const mockCommand = {
			id: "cmd-123",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { body: "lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "telegram:msg:100",
			correlationId: "corr-0",
			createdAt: new Date(),
			updatedAt: new Date(),
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			narrowingContext: null,
		};

		const getRecentTurns = vi.fn().mockResolvedValue([]);
		const getActivePendingCommandForUser = vi.fn().mockResolvedValue(mockCommand);

		const node = createLoadContextNode({
			db: {} as any,
			maxTurns: 10,
			getRecentTurns,
			getActivePendingCommandForUser,
		});

		const update = await node(makeState());
		expect(update.narrowingContext).toBeNull();
	});

	it("sets narrowingContext to null when there is no active pending command", async () => {
		const getRecentTurns = vi.fn().mockResolvedValue([]);
		const getActivePendingCommandForUser = vi.fn().mockResolvedValue(null);

		const node = createLoadContextNode({
			db: {} as any,
			maxTurns: 10,
			getRecentTurns,
			getActivePendingCommandForUser,
		});

		const update = await node(makeState());
		expect(update.narrowingContext).toBeNull();
	});

	it("loads unresolvedContactRef from active pending command when present", async () => {
		const mockCommand = {
			id: "cmd-123",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { body: "lunch" },
			status: "pending_confirmation",
			version: 2,
			sourceMessageRef: "telegram:msg:100",
			correlationId: "corr-0",
			createdAt: new Date(),
			updatedAt: new Date(),
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			narrowingContext: null,
			unresolvedContactRef: "mom",
		};

		const getRecentTurns = vi.fn().mockResolvedValue([]);
		const getActivePendingCommandForUser = vi.fn().mockResolvedValue(mockCommand);

		const node = createLoadContextNode({
			db: {} as any,
			maxTurns: 10,
			getRecentTurns,
			getActivePendingCommandForUser,
		});

		const update = await node(makeState());
		expect(update.unresolvedContactRef).toBe("mom");
	});

	it("sets unresolvedContactRef to null when active command has no unresolvedContactRef", async () => {
		const mockCommand = {
			id: "cmd-123",
			userId: "550e8400-e29b-41d4-a716-446655440000",
			commandType: "create_note",
			payload: { body: "lunch" },
			status: "draft",
			version: 1,
			sourceMessageRef: "telegram:msg:100",
			correlationId: "corr-0",
			createdAt: new Date(),
			updatedAt: new Date(),
			expiresAt: new Date(Date.now() + 30 * 60 * 1000),
			confirmedAt: null,
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			narrowingContext: null,
			unresolvedContactRef: null,
		};

		const getRecentTurns = vi.fn().mockResolvedValue([]);
		const getActivePendingCommandForUser = vi.fn().mockResolvedValue(mockCommand);

		const node = createLoadContextNode({
			db: {} as any,
			maxTurns: 10,
			getRecentTurns,
			getActivePendingCommandForUser,
		});

		const update = await node(makeState());
		expect(update.unresolvedContactRef).toBeNull();
	});

	it("sets unresolvedContactRef to null when no active pending command", async () => {
		const getRecentTurns = vi.fn().mockResolvedValue([]);
		const getActivePendingCommandForUser = vi.fn().mockResolvedValue(null);

		const node = createLoadContextNode({
			db: {} as any,
			maxTurns: 10,
			getRecentTurns,
			getActivePendingCommandForUser,
		});

		const update = await node(makeState());
		expect(update.unresolvedContactRef).toBeNull();
	});

	it("passes maxTurns to getRecentTurns", async () => {
		const getRecentTurns = vi.fn().mockResolvedValue([]);
		const getActivePendingCommandForUser = vi.fn().mockResolvedValue(null);

		const node = createLoadContextNode({
			db: {} as any,
			maxTurns: 5,
			getRecentTurns,
			getActivePendingCommandForUser,
		});

		await node(makeState());
		expect(getRecentTurns).toHaveBeenCalledWith(
			expect.anything(),
			"550e8400-e29b-41d4-a716-446655440000",
			5,
		);
	});
});
