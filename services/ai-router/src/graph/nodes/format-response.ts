/**
 * formatResponse graph node.
 *
 * Maps the intentClassification state field to a GraphResponse.
 *
 * When needsClarification is true:
 * - Without disambiguationOptions: produces a "text" response (simple clarification)
 * - With disambiguationOptions: produces a "disambiguation_prompt" response
 *
 * Per review MEDIUM-1: use `text` type for clarification without options,
 * `disambiguation_prompt` for clarification with options.
 */

import type { ConversationAnnotation, GraphResponse } from "../state.js";

type State = typeof ConversationAnnotation.State;
type Update = typeof ConversationAnnotation.Update;

/**
 * Formats the classification result into a GraphResponse.
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

	// Handle clarification with disambiguation options
	if (
		classification.needsClarification &&
		classification.disambiguationOptions &&
		classification.disambiguationOptions.length > 0
	) {
		const response: GraphResponse = {
			type: "disambiguation_prompt",
			text: classification.userFacingText,
			options: classification.disambiguationOptions,
		};

		// Include pending command reference if available
		if (state.activePendingCommand) {
			response.pendingCommandId = state.activePendingCommand.pendingCommandId;
			response.version = state.activePendingCommand.version;
		}

		return { response };
	}

	// All other cases (including clarification without options) use text type
	const response: GraphResponse = {
		type: "text",
		text: classification.userFacingText,
	};

	return { response };
}
