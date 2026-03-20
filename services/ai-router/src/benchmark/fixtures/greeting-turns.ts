/**
 * Greeting turn benchmark fixtures.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. No real user data, API keys,
 * credentials, or PII is used.
 *
 * These cases test the system's ability to recognize greeting
 * utterances that should produce a friendly response without
 * triggering any mutating command or read query.
 */
import type { IntentBenchmarkCase } from "@monica-companion/types";

export const greetingCases: IntentBenchmarkCase[] = [
	{
		id: "gr-001",
		category: "greeting",
		status: "active",
		description: "Simple English greeting",
		input: {
			utterance: "Hello",
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
		id: "gr-002",
		category: "greeting",
		status: "active",
		description: "Voice-style casual greeting",
		input: {
			utterance: "hey there how are you doing",
			voiceSamplePath: "voice/greeting/gr-002.ogg",
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
		id: "gr-003",
		category: "greeting",
		status: "active",
		description: "Greeting in Spanish",
		input: {
			utterance: "Hola, buenos dias",
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
		id: "gr-004",
		category: "greeting",
		status: "active",
		description: "Voice-style greeting with thanks",
		input: {
			utterance: "hi thanks for being here",
			voiceSamplePath: "voice/greeting/gr-004.ogg",
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
		id: "gr-005",
		category: "greeting",
		status: "active",
		description: "Greeting in French",
		input: {
			utterance: "Bonjour, comment ca va?",
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
];
