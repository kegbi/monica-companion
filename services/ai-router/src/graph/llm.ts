/**
 * LLM client factory for intent classification.
 *
 * Creates a ChatOpenAI instance bound with structured output for
 * intent classification. The factory accepts an API key parameter
 * to avoid importing from env directly.
 *
 * Uses an OpenAI-compatible schema (all fields required, nullable
 * instead of optional, explicit object instead of z.record) for the
 * API call, then converts the result to the internal
 * IntentClassificationResult type.
 */

import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod/v4";
import {
	ClarificationReasonSchema,
	DisambiguationOptionSchema,
	type IntentClassificationResult,
	IntentSchema,
} from "./intent-schemas.js";

export interface IntentClassifierConfig {
	openaiApiKey: string;
}

/**
 * OpenAI-compatible schema for structured output.
 *
 * Differences from IntentClassificationResultSchema:
 * - commandPayload: explicit object fields instead of z.record()
 *   (OpenAI rejects propertyNames / additionalProperties)
 * - needsClarification: required boolean, no .default()
 *   (OpenAI requires all fields in `required`)
 * - clarificationReason: nullable instead of optional
 * - disambiguationOptions: nullable instead of optional
 * - confidence: plain z.number() without .min/.max constraints
 *   (OpenAI may reject range constraints depending on version)
 */
const CommandPayloadLlmSchema = z
	.object({
		body: z.string().nullable(),
		date: z.string().nullable(),
		phone: z.string().nullable(),
		email: z.string().nullable(),
		address: z.string().nullable(),
		firstName: z.string().nullable(),
		lastName: z.string().nullable(),
		activityType: z.string().nullable(),
	})
	.nullable();

const IntentClassificationLlmSchema = z.object({
	intent: IntentSchema,
	detectedLanguage: z.string(),
	userFacingText: z.string(),
	commandType: z
		.enum([
			"create_contact",
			"create_note",
			"create_activity",
			"update_contact_birthday",
			"update_contact_phone",
			"update_contact_email",
			"update_contact_address",
			"query_birthday",
			"query_phone",
			"query_last_note",
		])
		.nullable(),
	contactRef: z.string().nullable(),
	commandPayload: CommandPayloadLlmSchema,
	confidence: z.number(),
	needsClarification: z.boolean(),
	clarificationReason: ClarificationReasonSchema.nullable(),
	disambiguationOptions: z.array(DisambiguationOptionSchema).nullable(),
});

type LlmOutput = z.infer<typeof IntentClassificationLlmSchema>;

/**
 * Converts the OpenAI-compatible LLM output to the internal
 * IntentClassificationResult type.
 *
 * - Strips null payload fields to produce a clean record
 * - Maps nullable fields to optional where the internal schema uses optional
 */
function toLlmResult(raw: LlmOutput): IntentClassificationResult {
	let commandPayload: Record<string, unknown> | null = null;
	if (raw.commandPayload) {
		const cleaned: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(raw.commandPayload)) {
			if (value !== null) {
				cleaned[key] = value;
			}
		}
		commandPayload = Object.keys(cleaned).length > 0 ? cleaned : null;
	}

	const result: IntentClassificationResult = {
		intent: raw.intent,
		detectedLanguage: raw.detectedLanguage,
		userFacingText: raw.userFacingText,
		commandType: raw.commandType,
		contactRef: raw.contactRef,
		commandPayload,
		confidence: Math.max(0, Math.min(1, raw.confidence)),
		needsClarification: raw.needsClarification,
	};

	if (raw.clarificationReason) {
		result.clarificationReason = raw.clarificationReason;
	}
	if (raw.disambiguationOptions && raw.disambiguationOptions.length > 0) {
		result.disambiguationOptions = raw.disambiguationOptions;
	}

	return result;
}

/**
 * Creates an intent classifier: a ChatOpenAI model bound to produce
 * structured output matching IntentClassificationResultSchema.
 *
 * Configuration:
 * - Model: gpt-5.4-mini (reasoning model — temperature must be default 1)
 * - Reasoning effort: medium
 * - Timeout: 30 seconds
 *
 * Returns an object with an invoke() method that accepts messages
 * and returns IntentClassificationResult.
 */
export function createIntentClassifier(config: IntentClassifierConfig) {
	const model = new ChatOpenAI({
		modelName: "gpt-5.4-mini",
		openAIApiKey: config.openaiApiKey,
		timeout: 30000,
		modelKwargs: {
			reasoning_effort: "medium",
		},
	});

	const structured = model.withStructuredOutput(IntentClassificationLlmSchema, {
		name: "intent_classification",
	});

	return {
		invoke: async (messages: unknown[]): Promise<IntentClassificationResult> => {
			// biome-ignore lint/suspicious/noExplicitAny: LangChain invoke() accepts BaseMessage[] but types are package-version-sensitive
			const raw = await structured.invoke(messages as any);
			return toLlmResult(raw);
		},
	};
}
