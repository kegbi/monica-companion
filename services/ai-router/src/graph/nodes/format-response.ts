/**
 * formatResponse graph node.
 *
 * Maps the intentClassification and actionOutcome state fields to a GraphResponse.
 *
 * Action outcomes drive the response type for mutating commands:
 * - pending_created → confirmation_prompt with pendingCommandId/version
 * - confirmed / auto_confirmed → text success message
 * - cancelled → text cancellation message
 * - stale_rejected → error with rejection reason
 * - edit_draft → text clarification (or disambiguation_prompt if options exist)
 * - read_through / passthrough → text from LLM userFacingText
 *
 * When needsClarification is true:
 * - Without disambiguationOptions: produces a "text" response (simple clarification)
 * - With disambiguationOptions: produces a "disambiguation_prompt" response
 */

import { trace } from "@opentelemetry/api";
import type { ActionOutcome, ConversationAnnotation, GraphResponse } from "../state.js";

const tracer = trace.getTracer("ai-router");

type State = typeof ConversationAnnotation.State;
type Update = typeof ConversationAnnotation.Update;

/**
 * Formats the classification result and action outcome into a GraphResponse.
 */
export function formatResponseNode(state: State): Update {
	return tracer.startActiveSpan("ai-router.graph.format_response", (span) => {
		try {
			const classification = state.intentClassification;
			const actionOutcome = state.actionOutcome;

			if (!classification) {
				const response: GraphResponse = {
					type: "error",
					text: "Unable to process your request.",
				};
				return { response };
			}

			// Handle action outcomes that override the default text response
			if (actionOutcome) {
				const overrideResponse = formatActionOutcome(actionOutcome, classification.userFacingText);
				if (overrideResponse) {
					return { response: overrideResponse };
				}
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

			// All other cases use text type
			const response: GraphResponse = {
				type: "text",
				text: classification.userFacingText,
			};

			return { response };
		} finally {
			span.end();
		}
	});
}

function formatActionOutcome(outcome: ActionOutcome, userFacingText: string): GraphResponse | null {
	switch (outcome.type) {
		case "pending_created":
			return {
				type: "confirmation_prompt",
				text: userFacingText,
				pendingCommandId: outcome.pendingCommandId,
				version: outcome.version,
			};

		case "confirmed":
			if (outcome.schedulerError) {
				return {
					type: "error",
					text: "Your command was confirmed but could not be executed. Please try again.",
				};
			}
			return {
				type: "text",
				text: userFacingText,
			};

		case "auto_confirmed":
			if (outcome.schedulerError) {
				return {
					type: "error",
					text: "Your command was confirmed but could not be executed. Please try again.",
				};
			}
			return {
				type: "text",
				text: userFacingText,
			};

		case "cancelled":
			return {
				type: "text",
				text: userFacingText,
			};

		case "stale_rejected":
			return {
				type: "error",
				text: outcome.reason,
			};

		case "edit_draft":
			// Clarification/disambiguation handled by the default path below
			return null;

		case "read_through":
		case "passthrough":
			// Use default text response from LLM
			return null;
	}
}
