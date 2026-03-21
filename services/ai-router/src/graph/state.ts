/**
 * LangGraph conversation state schema.
 *
 * Defines the typed state that flows through the conversation graph.
 * Fields marked as "provisional" are defined for future graph nodes
 * (intent classification, contact resolution, etc.) but are not
 * used by the current echo node.
 */

import { Annotation } from "@langchain/langgraph";
import {
	ContactResolutionResult,
	type ContactResolutionSummary,
	InboundEventSchema,
} from "@monica-companion/types";
import { z } from "zod/v4";
import {
	type IntentClassificationResult,
	IntentClassificationResultSchema,
} from "./intent-schemas.js";

// --- Supporting Zod schemas ---

export const TurnSummarySchema = z.object({
	role: z.enum(["user", "assistant", "system"]),
	summary: z.string().min(1),
	createdAt: z.string().min(1),
	correlationId: z.string().min(1),
});

export type TurnSummary = z.infer<typeof TurnSummarySchema>;

export const PendingCommandRefSchema = z.object({
	pendingCommandId: z.string().min(1),
	version: z.number().int().positive(),
	status: z.string().min(1),
	commandType: z.string().min(1),
});

export type PendingCommandRef = z.infer<typeof PendingCommandRefSchema>;

export const ActionOutcomeSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("pending_created"),
		pendingCommandId: z.string(),
		version: z.number().int().positive(),
	}),
	z.object({
		type: z.literal("confirmed"),
		pendingCommandId: z.string(),
		schedulerError: z.string().optional(),
	}),
	z.object({
		type: z.literal("auto_confirmed"),
		pendingCommandId: z.string(),
		schedulerError: z.string().optional(),
	}),
	z.object({ type: z.literal("cancelled") }),
	z.object({ type: z.literal("edit_draft") }),
	z.object({
		type: z.literal("stale_rejected"),
		reason: z.string(),
	}),
	z.object({ type: z.literal("read_through") }),
	z.object({ type: z.literal("passthrough") }),
]);

export type ActionOutcome = z.infer<typeof ActionOutcomeSchema>;

export const GraphResponseSchema = z.object({
	type: z.enum(["text", "confirmation_prompt", "disambiguation_prompt", "error"]),
	text: z.string().min(1),
	pendingCommandId: z.string().optional(),
	version: z.number().int().positive().optional(),
	options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
});

export type GraphResponse = z.infer<typeof GraphResponseSchema>;

// --- Full conversation state Zod schema (for validation) ---

export const ConversationStateSchema = z.object({
	userId: z.string().min(1),
	correlationId: z.string().min(1),
	inboundEvent: InboundEventSchema,
	/** Loaded from conversation_turns -- provisional, not used by echo node */
	recentTurns: z.array(TurnSummarySchema).default([]),
	/** Provisional: reference to active pending command */
	activePendingCommand: PendingCommandRefSchema.nullable().default(null),
	/** Contact resolution result from the resolveContactRef node */
	contactResolution: ContactResolutionResult.nullable().default(null),
	/** Cached contact summaries loaded once per graph invocation */
	contactSummariesCache: z.array(z.any()).nullable().default(null),
	/** Provisional: user preferences (language, timezone, etc.) */
	userPreferences: z.record(z.string(), z.unknown()).nullable().default(null),
	/** Intent classification result from LLM */
	intentClassification: IntentClassificationResultSchema.nullable().default(null),
	/** Action outcome from executeAction node */
	actionOutcome: ActionOutcomeSchema.nullable().default(null),
	/** The final output of the graph */
	response: GraphResponseSchema.nullable().default(null),
});

export type ConversationState = z.infer<typeof ConversationStateSchema>;

// --- LangGraph Annotation (channel-based state for StateGraph) ---

export const ConversationAnnotation = Annotation.Root({
	userId: Annotation<string>,
	correlationId: Annotation<string>,
	inboundEvent: Annotation<z.infer<typeof InboundEventSchema>>,
	recentTurns: Annotation<TurnSummary[]>({
		reducer: (_prev, next) => next,
		default: () => [],
	}),
	activePendingCommand: Annotation<PendingCommandRef | null>({
		reducer: (_prev, next) => next,
		default: () => null,
	}),
	contactResolution: Annotation<z.infer<typeof ContactResolutionResult> | null>({
		reducer: (_prev, next) => next,
		default: () => null,
	}),
	contactSummariesCache: Annotation<ContactResolutionSummary[] | null>({
		reducer: (_prev, next) => next,
		default: () => null,
	}),
	userPreferences: Annotation<Record<string, unknown> | null>({
		reducer: (_prev, next) => next,
		default: () => null,
	}),
	intentClassification: Annotation<IntentClassificationResult | null>({
		reducer: (_prev, next) => next,
		default: () => null,
	}),
	actionOutcome: Annotation<ActionOutcome | null>({
		reducer: (_prev, next) => next,
		default: () => null,
	}),
	response: Annotation<GraphResponse | null>({
		reducer: (_prev, next) => next,
		default: () => null,
	}),
});
