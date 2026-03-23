/**
 * Multi-turn disambiguation integration test.
 *
 * Validates the Artillery Park regression scenario: a user sends
 * "Add a note to mum: today we went to Artillery Park", gets disambiguation,
 * then narrows to "Elena", and the note body must still contain "Artillery Park".
 *
 * Also tests the cancellation flow across multiple turns.
 *
 * These tests exercise runAgentLoop across multiple invocations, simulating
 * real DB persistence by capturing saveHistory output and replaying it via
 * getHistory mocks.
 */

import type { ServiceClient } from "@monica-companion/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentLoopDeps } from "../loop.js";

// Mock openai to avoid import issues
vi.mock("openai", () => ({
	default: class MockOpenAI {
		chat = { completions: { create: vi.fn() } };
	},
}));

// Mock tool handlers
vi.mock("../tool-handlers/search-contacts.js", () => ({
	handleSearchContacts: vi.fn(),
}));
vi.mock("../tool-handlers/query-birthday.js", () => ({
	handleQueryBirthday: vi.fn(),
}));
vi.mock("../tool-handlers/query-phone.js", () => ({
	handleQueryPhone: vi.fn(),
}));
vi.mock("../tool-handlers/query-last-note.js", () => ({
	handleQueryLastNote: vi.fn(),
}));
vi.mock("../tool-handlers/mutating-handlers.js", () => ({
	executeMutatingTool: vi.fn(),
}));

import { runAgentLoop } from "../loop.js";
import { executeMutatingTool } from "../tool-handlers/mutating-handlers.js";
import { handleSearchContacts } from "../tool-handlers/search-contacts.js";

const mockedHandleSearchContacts = vi.mocked(handleSearchContacts);
const mockedExecuteMutatingTool = vi.mocked(executeMutatingTool);

function createMockServiceClient(): ServiceClient {
	return {
		fetch: vi.fn(),
	};
}

const userId = "550e8400-e29b-41d4-a716-446655440000";
const correlationId = "corr-integration-1";

describe("multi-turn disambiguation integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("Scenario 1: Artillery Park — note body preserved across disambiguation turns", async () => {
		// State containers to simulate DB persistence between turns
		let savedMessages: unknown[] = [];
		let savedPendingToolCall: unknown = null;

		const getHistory = vi.fn();
		const saveHistory = vi.fn();

		// Capture saveHistory calls to replay as getHistory in subsequent turns
		saveHistory.mockImplementation(
			async (_db: unknown, _userId: string, msgs: unknown[], pending: unknown) => {
				savedMessages = msgs;
				savedPendingToolCall = pending;
			},
		);

		const chatCompletion = vi.fn();
		const monicaServiceClient = createMockServiceClient();
		const schedulerClient = {
			execute: vi.fn().mockResolvedValue({ executionId: "exec-1", status: "queued" }),
		};

		function makeDeps(): AgentLoopDeps {
			return {
				llmClient: { chatCompletion },
				db: {} as never,
				getHistory,
				saveHistory,
				pendingCommandTtlMinutes: 30,
				monicaServiceClient,
				schedulerClient,
			};
		}

		// ---- TURN 1: "Add a note to mum: today we went to Artillery Park" ----

		// search_contacts returns 8 results (ambiguous)
		mockedHandleSearchContacts.mockResolvedValueOnce({
			status: "ok",
			contacts: Array.from({ length: 8 }, (_, i) => ({
				contactId: i + 1,
				displayName: `Contact ${i + 1}`,
				aliases: [],
				relationshipLabels: ["mother"],
				birthdate: null,
				matchReason: "kinship_label" as const,
			})),
		});

		// LLM Turn 1, Call 1: calls search_contacts("mum")
		chatCompletion.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "sc1",
								type: "function",
								function: {
									name: "search_contacts",
									arguments: '{"query": "mum"}',
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		});

		// LLM Turn 1, Call 2: generates disambiguation text
		chatCompletion.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content:
							"I found 8 contacts matching mum. What is your mom's name so I can narrow it down?",
						tool_calls: undefined,
					},
					finish_reason: "stop",
				},
			],
		});

		getHistory.mockResolvedValueOnce(null); // No prior history

		const turn1Result = await runAgentLoop(
			makeDeps(),
			userId,
			{
				type: "text_message" as const,
				userId,
				sourceRef: "telegram:msg:t1",
				correlationId,
				text: "Add a note to mum: today we went to Artillery Park",
			},
			correlationId,
		);

		expect(turn1Result.type).toBe("text");
		expect(turn1Result.text).toContain("8 contacts");
		expect(saveHistory).toHaveBeenCalledTimes(1);

		// ---- TURN 2: User says "Elena" to narrow down ----

		// Return the saved history from turn 1
		getHistory.mockResolvedValueOnce({
			id: "hist-1",
			userId,
			messages: savedMessages,
			pendingToolCall: savedPendingToolCall,
			updatedAt: new Date(),
		});

		// search_contacts returns 1 result for "Elena"
		mockedHandleSearchContacts.mockResolvedValueOnce({
			status: "ok",
			contacts: [
				{
					contactId: 682023,
					displayName: "Elena Yuryevna",
					aliases: ["Elena"],
					relationshipLabels: ["mother"],
					birthdate: null,
					matchReason: "exact_first_name" as const,
				},
			],
		});

		// LLM Turn 2, Call 1: calls search_contacts("Elena")
		chatCompletion.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "sc2",
								type: "function",
								function: {
									name: "search_contacts",
									arguments: '{"query": "Elena"}',
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		});

		// LLM Turn 2, Call 2: calls create_note with the resolved contact
		chatCompletion.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "cn1",
								type: "function",
								function: {
									name: "create_note",
									arguments: JSON.stringify({
										contact_id: 682023,
										body: "Today we went to Artillery Park",
									}),
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		});

		const turn2Result = await runAgentLoop(
			makeDeps(),
			userId,
			{
				type: "text_message" as const,
				userId,
				sourceRef: "telegram:msg:t2",
				correlationId,
				text: "Elena",
			},
			correlationId,
		);

		// Turn 2 should return a confirmation_prompt (mutating tool intercepted)
		expect(turn2Result.type).toBe("confirmation_prompt");
		expect(turn2Result.pendingCommandId).toBeTruthy();
		expect(saveHistory).toHaveBeenCalledTimes(2);

		// CRITICAL ASSERTION: The pending tool call contains "Artillery Park" in the note body
		const turn2SaveCall = saveHistory.mock.calls[1];
		const pendingToolCall = turn2SaveCall[3];
		expect(pendingToolCall).not.toBeNull();
		expect(pendingToolCall.name).toBe("create_note");
		const args = JSON.parse(pendingToolCall.arguments);
		expect(args.body.toLowerCase()).toContain("artillery park");
		expect(args.contact_id).toBe(682023);

		// ---- TURN 3: User confirms ----

		getHistory.mockResolvedValueOnce({
			id: "hist-1",
			userId,
			messages: savedMessages,
			pendingToolCall: savedPendingToolCall,
			updatedAt: new Date(),
		});

		mockedExecuteMutatingTool.mockResolvedValueOnce({
			status: "success",
			executionId: "exec-artillery",
		});

		// LLM Turn 3: generates success message after confirmation
		chatCompletion.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: "Done! I added the note about Artillery Park to Elena Yuryevna.",
						tool_calls: undefined,
					},
					finish_reason: "stop",
				},
			],
		});

		const turn3Result = await runAgentLoop(
			makeDeps(),
			userId,
			{
				type: "callback_action" as const,
				userId,
				sourceRef: "telegram:msg:t3",
				correlationId,
				action: "confirm",
				data: `confirm:${pendingToolCall.pendingCommandId}:1`,
			},
			correlationId,
		);

		expect(turn3Result.type).toBe("text");
		expect(turn3Result.text).toContain("Artillery Park");
		expect(mockedExecuteMutatingTool).toHaveBeenCalledWith(
			expect.objectContaining({
				toolName: "create_note",
				userId,
				correlationId,
				pendingCommandId: pendingToolCall.pendingCommandId,
			}),
		);
	});

	it("Scenario 2: User cancels at confirmation step", async () => {
		let savedMessages: unknown[] = [];
		let savedPendingToolCall: unknown = null;

		const getHistory = vi.fn();
		const saveHistory = vi.fn();

		saveHistory.mockImplementation(
			async (_db: unknown, _userId: string, msgs: unknown[], pending: unknown) => {
				savedMessages = msgs;
				savedPendingToolCall = pending;
			},
		);

		const chatCompletion = vi.fn();

		function makeDeps(): AgentLoopDeps {
			return {
				llmClient: { chatCompletion },
				db: {} as never,
				getHistory,
				saveHistory,
				pendingCommandTtlMinutes: 30,
				monicaServiceClient: createMockServiceClient(),
				schedulerClient: {
					execute: vi.fn().mockResolvedValue({ executionId: "exec-1", status: "queued" }),
				},
			};
		}

		// ---- TURN 1: Mutating request -> confirmation ----

		getHistory.mockResolvedValueOnce(null);

		// LLM calls create_note directly
		chatCompletion.mockResolvedValueOnce({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "cn_cancel",
								type: "function",
								function: {
									name: "create_note",
									arguments: '{"contact_id": 1, "body": "Test note"}',
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		});

		const turn1Result = await runAgentLoop(
			makeDeps(),
			userId,
			{
				type: "text_message" as const,
				userId,
				sourceRef: "telegram:msg:cancel-t1",
				correlationId,
				text: "Add a note to contact 1: Test note",
			},
			correlationId,
		);

		expect(turn1Result.type).toBe("confirmation_prompt");
		const pendingCommandId = (savedPendingToolCall as { pendingCommandId: string })
			.pendingCommandId;

		// ---- TURN 2: User cancels ----

		getHistory.mockResolvedValueOnce({
			id: "hist-1",
			userId,
			messages: savedMessages,
			pendingToolCall: savedPendingToolCall,
			updatedAt: new Date(),
		});

		chatCompletion.mockResolvedValueOnce({
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

		const turn2Result = await runAgentLoop(
			makeDeps(),
			userId,
			{
				type: "callback_action" as const,
				userId,
				sourceRef: "telegram:msg:cancel-t2",
				correlationId,
				action: "cancel",
				data: `cancel:${pendingCommandId}:1`,
			},
			correlationId,
		);

		expect(turn2Result.type).toBe("text");
		expect(turn2Result.text).toContain("cancel");
		expect(mockedExecuteMutatingTool).not.toHaveBeenCalled();

		// History should be saved with null pendingToolCall
		const lastSaveCall = saveHistory.mock.calls[saveHistory.mock.calls.length - 1];
		expect(lastSaveCall[3]).toBeNull();
	});
});
