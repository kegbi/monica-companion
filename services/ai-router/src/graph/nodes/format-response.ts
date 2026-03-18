/**
 * formatResponse graph node.
 *
 * Maps the intentClassification state field to a GraphResponse.
 *
 * This node is intentionally separate from classifyIntent to serve as an
 * extension point: later tasks will add richer response formatting here
 * (confirmation prompts with inline keyboards, disambiguation prompts,
 * read-query result formatting after data fetch, etc.) without modifying
 * the classification node. Per review LOW-1.
 */

import type { ConversationAnnotation, GraphResponse } from "../state.js";

type State = typeof ConversationAnnotation.State;
type Update = typeof ConversationAnnotation.Update;

/**
 * Formats the classification result into a GraphResponse.
 * Currently all intents produce a simple text response using userFacingText.
 */
export function formatResponseNode(state: State): Update {
	const classification = state.intentClassification;

	if (!classification) {
		const response: GraphResponse = {
			type: "error",
			text: "Unable to process your request.",
		};
		return { response };
	}

	const response: GraphResponse = {
		type: "text",
		text: classification.userFacingText,
	};

	return { response };
}
