/**
 * LangGraph conversation graph.
 *
 * V1 skeleton: START -> process -> END
 * The "process" node is a placeholder echo that acknowledges the inbound event.
 * Real LLM calls are added in the Intent Classification task.
 */

import { END, START, StateGraph } from "@langchain/langgraph";
import { ConversationAnnotation, type GraphResponse } from "./state.js";

type State = typeof ConversationAnnotation.State;
type Update = typeof ConversationAnnotation.Update;

/**
 * Echo node: reads the inbound event and produces an acknowledgment response.
 * Does NOT call any external API or LLM.
 */
function processNode(state: State): Update {
	const eventType = state.inboundEvent.type;
	const response: GraphResponse = {
		type: "text",
		text: `Received ${eventType} event. Processing is not yet implemented.`,
	};
	return { response };
}

/**
 * Creates and compiles the conversation StateGraph.
 * Returns a compiled graph ready for invocation.
 */
export function createConversationGraph() {
	const graph = new StateGraph(ConversationAnnotation)
		.addNode("process", processNode)
		.addEdge(START, "process")
		.addEdge("process", END);

	return graph.compile();
}
