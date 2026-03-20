/**
 * Out-of-scope turn benchmark fixtures.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. No real user data, API keys,
 * credentials, or PII is used.
 *
 * These cases test the system's ability to recognize requests that
 * fall outside Monica contact management scope. The expected behavior
 * is to NOT trigger any mutating command or read query.
 *
 * Patterns: weather, programming help, jokes, math, translations,
 * general knowledge, recipe requests, sports scores, news queries.
 */
import type { IntentBenchmarkCase } from "@monica-companion/types";

export const outOfScopeCases: IntentBenchmarkCase[] = [
	{
		id: "oos-001",
		category: "out_of_scope",
		status: "active",
		description: "Weather query",
		input: {
			utterance: "What is the weather like today?",
			voiceSamplePath: null,
			contactContext: [],
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "oos-002",
		category: "out_of_scope",
		status: "active",
		description: "Voice-style programming help request",
		input: {
			utterance: "hey can you help me write a python script to sort a list",
			voiceSamplePath: "voice/out_of_scope/oos-002.ogg",
			contactContext: [],
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "oos-003",
		category: "out_of_scope",
		status: "active",
		description: "Joke request",
		input: {
			utterance: "Tell me a funny joke",
			voiceSamplePath: null,
			contactContext: [],
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "oos-004",
		category: "out_of_scope",
		status: "active",
		description: "Math problem",
		input: {
			utterance: "What is 347 times 892?",
			voiceSamplePath: null,
			contactContext: [],
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "oos-005",
		category: "out_of_scope",
		status: "active",
		description: "Voice-style translation request",
		input: {
			utterance: "how do you say good morning in japanese",
			voiceSamplePath: "voice/out_of_scope/oos-005.ogg",
			contactContext: [],
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "oos-006",
		category: "out_of_scope",
		status: "active",
		description: "General knowledge question",
		input: {
			utterance: "Who was the first person to walk on the moon?",
			voiceSamplePath: null,
			contactContext: [],
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "oos-007",
		category: "out_of_scope",
		status: "active",
		description: "Recipe request in Spanish",
		input: {
			utterance: "Dame una receta para hacer paella",
			voiceSamplePath: null,
			contactContext: [],
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "oos-008",
		category: "out_of_scope",
		status: "active",
		description: "Voice-style sports score query",
		input: {
			utterance: "whats the score of the lakers game right now",
			voiceSamplePath: "voice/out_of_scope/oos-008.ogg",
			contactContext: [],
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "oos-009",
		category: "out_of_scope",
		status: "active",
		description: "News query in French",
		input: {
			utterance: "Quelles sont les dernieres nouvelles?",
			voiceSamplePath: null,
			contactContext: [],
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
	{
		id: "oos-010",
		category: "out_of_scope",
		status: "active",
		description: "Voice-style restaurant recommendation",
		input: {
			utterance: "um can you recommend a good sushi restaurant near me",
			voiceSamplePath: "voice/out_of_scope/oos-010.ogg",
			contactContext: [],
		},
		expected: {
			commandType: null,
			contactRef: null,
			resolvedContactId: null,
			isMutating: false,
		},
	},
];
