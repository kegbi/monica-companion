/**
 * Integration tests for search_contacts multi-turn disambiguation flow.
 *
 * Uses a scripted mock LLM that returns predetermined responses based on
 * the tool results it receives, simulating multi-turn conversation flows.
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

// Mock the search_contacts handler so we control its output
vi.mock("../tool-handlers/search-contacts.js", () => ({
	handleSearchContacts: vi.fn(),
}));

import { runAgentLoop } from "../loop.js";
import { handleSearchContacts } from "../tool-handlers/search-contacts.js";

const mockedHandleSearchContacts = vi.mocked(handleSearchContacts);

function createMockServiceClient(): ServiceClient {
	return {
		fetch: vi.fn(),
	};
}

const userId = "550e8400-e29b-41d4-a716-446655440000";
const correlationId = "corr-integration-test";

function textEvent(text: string) {
	return {
		type: "text_message" as const,
		userId,
		sourceRef: `telegram:msg:${Date.now()}`,
		correlationId,
		text,
	};
}

describe("search_contacts integration — multi-turn disambiguation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("unambiguous: single result leads LLM to proceed with the action", async () => {
		// Handler returns exactly one match
		mockedHandleSearchContacts.mockResolvedValue({
			status: "ok",
			contacts: [
				{
					contactId: 42,
					displayName: "Jane Doe",
					aliases: ["Jane", "Doe"],
					relationshipLabels: ["friend"],
					birthdate: "1990-05-15",
					matchReason: "exact_display_name",
				},
			],
		});

		// Scripted LLM:
		// 1st call: LLM calls search_contacts
		// 2nd call: LLM receives single match, proceeds to call create_note
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
									id: "call_search",
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
							content: null,
							tool_calls: [
								{
									id: "call_note",
									type: "function",
									function: {
										name: "create_note",
										arguments: '{"contact_id": 42, "body": "Had coffee today"}',
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			});

		const deps: AgentLoopDeps = {
			llmClient: { chatCompletion },
			db: {} as never,
			getHistory: vi.fn().mockResolvedValue(null),
			saveHistory: vi.fn().mockResolvedValue(undefined),
			pendingCommandTtlMinutes: 30,
			monicaServiceClient: createMockServiceClient(),
		};

		const result = await runAgentLoop(
			deps,
			userId,
			textEvent("Add a note to Jane: Had coffee today"),
			correlationId,
		);

		// Should intercept the mutating tool and return confirmation
		expect(result.type).toBe("confirmation_prompt");
		expect(result.text).toContain("Create a note");

		// Handler was called with the search query
		expect(mockedHandleSearchContacts).toHaveBeenCalledWith(
			expect.objectContaining({ query: "Jane" }),
		);
	});

	it("ambiguous: multiple results leads LLM to ask for clarification", async () => {
		// Handler returns multiple matches
		mockedHandleSearchContacts.mockResolvedValue({
			status: "ok",
			contacts: [
				{
					contactId: 1,
					displayName: "Jane Doe",
					aliases: ["Jane", "Doe"],
					relationshipLabels: ["friend"],
					birthdate: "1990-05-15",
					matchReason: "alias_match",
				},
				{
					contactId: 2,
					displayName: "Jane Smith",
					aliases: ["Jane", "Smith"],
					relationshipLabels: ["colleague"],
					birthdate: null,
					matchReason: "alias_match",
				},
				{
					contactId: 3,
					displayName: "Janet Williams",
					aliases: ["Janet", "Williams"],
					relationshipLabels: [],
					birthdate: null,
					matchReason: "partial_match",
				},
			],
		});

		// Scripted LLM:
		// 1st call: LLM calls search_contacts
		// 2nd call: LLM sees multiple matches, asks for clarification
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
									id: "call_search",
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
							content:
								"I found multiple contacts named Jane:\n1. Jane Doe (friend)\n2. Jane Smith (colleague)\n3. Janet Williams\nWhich one did you mean?",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps: AgentLoopDeps = {
			llmClient: { chatCompletion },
			db: {} as never,
			getHistory: vi.fn().mockResolvedValue(null),
			saveHistory: vi.fn().mockResolvedValue(undefined),
			pendingCommandTtlMinutes: 30,
			monicaServiceClient: createMockServiceClient(),
		};

		const result = await runAgentLoop(
			deps,
			userId,
			textEvent("What is Jane's birthday?"),
			correlationId,
		);

		expect(result.type).toBe("text");
		expect(result.text).toContain("Jane");
		expect(result.text).toContain("Which one");

		// Verify the tool result passed to 2nd LLM call contained all 3 contacts
		const secondCall = chatCompletion.mock.calls[1];
		const messages = secondCall[0];
		const toolResultMsg = messages.find(
			(m: { role: string; tool_call_id?: string }) =>
				m.role === "tool" && m.tool_call_id === "call_search",
		);
		expect(toolResultMsg).toBeTruthy();
		const parsed = JSON.parse(toolResultMsg.content);
		expect(parsed.contacts).toHaveLength(3);
	});

	it("no match: zero results leads LLM to ask for clarification", async () => {
		// Handler returns no matches
		mockedHandleSearchContacts.mockResolvedValue({
			status: "ok",
			contacts: [],
		});

		// Scripted LLM:
		// 1st call: LLM calls search_contacts
		// 2nd call: LLM sees zero matches, asks for clarification
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
									id: "call_search",
									type: "function",
									function: {
										name: "search_contacts",
										arguments: '{"query": "Zyx"}',
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
							content:
								"I could not find a contact named Zyx. Could you provide more details or would you like to create a new contact?",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps: AgentLoopDeps = {
			llmClient: { chatCompletion },
			db: {} as never,
			getHistory: vi.fn().mockResolvedValue(null),
			saveHistory: vi.fn().mockResolvedValue(undefined),
			pendingCommandTtlMinutes: 30,
			monicaServiceClient: createMockServiceClient(),
		};

		const result = await runAgentLoop(deps, userId, textEvent("Add a note to Zyx"), correlationId);

		expect(result.type).toBe("text");
		expect(result.text).toContain("could not find");
	});

	it("kinship term: 'mom' triggers search and returns relationship-matched contacts", async () => {
		// Handler returns contacts matched by relationship label
		mockedHandleSearchContacts.mockResolvedValue({
			status: "ok",
			contacts: [
				{
					contactId: 10,
					displayName: "Maria Johnson",
					aliases: ["Maria", "Johnson"],
					relationshipLabels: ["parent"],
					birthdate: "1960-03-20",
					matchReason: "relationship_label_match",
				},
			],
		});

		// Scripted LLM:
		// 1st call: LLM calls search_contacts with "mom"
		// 2nd call: LLM sees single match with relationship label, proceeds
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
									id: "call_search_mom",
									type: "function",
									function: {
										name: "search_contacts",
										arguments: '{"query": "mom"}',
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
							content: "Your mom Maria Johnson's birthday is March 20, 1960.",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps: AgentLoopDeps = {
			llmClient: { chatCompletion },
			db: {} as never,
			getHistory: vi.fn().mockResolvedValue(null),
			saveHistory: vi.fn().mockResolvedValue(undefined),
			pendingCommandTtlMinutes: 30,
			monicaServiceClient: createMockServiceClient(),
		};

		const result = await runAgentLoop(
			deps,
			userId,
			textEvent("When is my mom's birthday?"),
			correlationId,
		);

		expect(result.type).toBe("text");
		expect(result.text).toContain("Maria Johnson");

		// Verify handler was called with "mom"
		expect(mockedHandleSearchContacts).toHaveBeenCalledWith(
			expect.objectContaining({ query: "mom" }),
		);

		// Verify the tool result included relationship labels
		const secondCall = chatCompletion.mock.calls[1];
		const messages = secondCall[0];
		const toolResultMsg = messages.find(
			(m: { role: string; tool_call_id?: string }) =>
				m.role === "tool" && m.tool_call_id === "call_search_mom",
		);
		expect(toolResultMsg).toBeTruthy();
		const parsed = JSON.parse(toolResultMsg.content);
		expect(parsed.contacts[0].relationshipLabels).toContain("parent");
		expect(parsed.contacts[0].matchReason).toBe("relationship_label_match");
	});

	it("service error: handler returns error, LLM tells user gracefully", async () => {
		// Handler returns an error
		mockedHandleSearchContacts.mockResolvedValue({
			status: "error",
			message: "Unable to complete contact search. Please try again later.",
		});

		// Scripted LLM:
		// 1st call: LLM calls search_contacts
		// 2nd call: LLM sees error, tells user
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
									id: "call_search_err",
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
							content:
								"I'm sorry, I was unable to search for contacts right now. Please try again later.",
							tool_calls: undefined,
						},
						finish_reason: "stop",
					},
				],
			});

		const deps: AgentLoopDeps = {
			llmClient: { chatCompletion },
			db: {} as never,
			getHistory: vi.fn().mockResolvedValue(null),
			saveHistory: vi.fn().mockResolvedValue(undefined),
			pendingCommandTtlMinutes: 30,
			monicaServiceClient: createMockServiceClient(),
		};

		const result = await runAgentLoop(deps, userId, textEvent("Find Jane"), correlationId);

		expect(result.type).toBe("text");
		expect(result.text).toContain("unable");
	});
});
