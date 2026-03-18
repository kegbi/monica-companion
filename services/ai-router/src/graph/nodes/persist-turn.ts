/**
 * persistTurn graph node.
 *
 * Writes compressed turn summaries to the database after processing.
 * Never stores raw utterances or full LLM responses (data governance).
 *
 * Summaries are passed through @monica-companion/redaction as defense-in-depth
 * per review MEDIUM-2.
 *
 * Error-resilient: catches DB errors so the user still gets their response.
 */

import type { Database } from "../../db/connection.js";
import type { InsertTurnParams } from "../../db/turn-repository.js";
import type { ConversationAnnotation } from "../state.js";

type State = typeof ConversationAnnotation.State;
type Update = typeof ConversationAnnotation.Update;

export interface PersistTurnDeps {
	db: Database;
	insertTurnSummary: (db: Database, params: InsertTurnParams) => Promise<unknown>;
	redactString: (value: string) => string;
}

/**
 * Compresses user intent into a short summary string.
 * Format: "{intent}" or "{intent}: {commandType} for {contactRef}"
 * Never includes raw utterances or payload details.
 */
function compressUserSummary(classification: {
	intent: string;
	commandType: string | null;
	contactRef: string | null;
}): string {
	const parts = [`Requested ${classification.intent}`];
	if (classification.commandType) {
		parts[0] = `Requested ${classification.commandType}`;
	}
	if (classification.contactRef) {
		parts.push(`for ${classification.contactRef}`);
	}
	return parts.join(" ");
}

/**
 * Compresses assistant response into a short summary string.
 * Format: "Responded with {type}" or "Responded with {type}: disambiguation"
 */
function compressAssistantSummary(response: { type: string }): string {
	return `Responded with ${response.type}`;
}

/**
 * Creates a persistTurn node function with injected dependencies.
 */
export function createPersistTurnNode(deps: PersistTurnDeps) {
	return async function persistTurnNode(state: State): Promise<Update> {
		// Skip persistence when there's nothing to persist
		if (!state.intentClassification) {
			return {};
		}

		try {
			const userSummary = deps.redactString(compressUserSummary(state.intentClassification));

			await deps.insertTurnSummary(deps.db, {
				userId: state.userId,
				role: "user",
				summary: userSummary,
				correlationId: state.correlationId,
			});

			if (state.response) {
				const assistantSummary = deps.redactString(compressAssistantSummary(state.response));

				await deps.insertTurnSummary(deps.db, {
					userId: state.userId,
					role: "assistant",
					summary: assistantSummary,
					correlationId: state.correlationId,
				});
			}
		} catch (_error) {
			// Best-effort persistence: DB errors should not block user response.
			// TODO: Emit a counter metric (persist_turn_failures_total) when OTel is wired.
		}

		return {};
	};
}
