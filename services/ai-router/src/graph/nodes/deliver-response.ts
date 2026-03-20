/**
 * deliverResponse graph node.
 *
 * Sends the formatted GraphResponse to the delivery service for routing
 * to the appropriate connector (e.g., Telegram).
 *
 * Best-effort: delivery failures are caught so the user's response is still
 * stored in graph state and returned to the caller. Delivery failures are
 * observable via the delivery service's own audit trail.
 */

import type { OutboundContent, OutboundMessageIntent } from "@monica-companion/types";
import { trace } from "@opentelemetry/api";
import type { DeliveryClient } from "../../lib/delivery-client.js";
import type { UserManagementClient } from "../../lib/user-management-client.js";
import type { ConversationAnnotation, GraphResponse } from "../state.js";

const tracer = trace.getTracer("ai-router");

type State = typeof ConversationAnnotation.State;
type Update = typeof ConversationAnnotation.Update;

export interface DeliverResponseDeps {
	deliveryClient: Pick<DeliveryClient, "deliver">;
	userManagementClient: Pick<UserManagementClient, "getDeliveryRouting">;
}

function mapResponseToContent(response: GraphResponse): OutboundContent {
	switch (response.type) {
		case "confirmation_prompt":
			return {
				type: "confirmation_prompt",
				text: response.text,
				pendingCommandId: response.pendingCommandId!,
				version: response.version!,
			};
		case "disambiguation_prompt":
			return {
				type: "disambiguation_prompt",
				text: response.text,
				options: response.options!,
			};
		case "error":
			return { type: "error", text: response.text };
		case "text":
		default:
			return { type: "text", text: response.text };
	}
}

export function createDeliverResponseNode(deps: DeliverResponseDeps) {
	return async function deliverResponseNode(state: State): Promise<Update> {
		return tracer.startActiveSpan("ai-router.graph.deliver_response", async (span) => {
			try {
				if (!state.response) {
					return {};
				}

				try {
					const routing = await deps.userManagementClient.getDeliveryRouting(
						state.userId,
						state.correlationId,
					);

					const content = mapResponseToContent(state.response);

					const intent: OutboundMessageIntent = {
						userId: state.userId,
						connectorType: routing.connectorType,
						connectorRoutingId: routing.connectorRoutingId,
						correlationId: state.correlationId,
						content,
					};

					await deps.deliveryClient.deliver(intent);
				} catch {
					// Best-effort delivery: failures don't block the graph response.
					// Delivery audit trail in the delivery service tracks failures.
				}

				return {};
			} finally {
				span.end();
			}
		});
	};
}
