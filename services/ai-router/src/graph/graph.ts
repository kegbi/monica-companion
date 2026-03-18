/**
 * LangGraph conversation graph.
 *
 * Topology: START -> classifyIntent -> formatResponse -> END
 *
 * The classifyIntent node invokes the LLM to classify the user's utterance
 * and extract command metadata. The formatResponse node maps the classification
 * result to a GraphResponse for delivery.
 */

import { END, START, StateGraph } from "@langchain/langgraph";
import { createIntentClassifier } from "./llm.js";
import { createClassifyIntentNode } from "./nodes/classify-intent.js";
import { formatResponseNode } from "./nodes/format-response.js";
import { ConversationAnnotation } from "./state.js";

export interface ConversationGraphConfig {
	openaiApiKey: string;
}

/**
 * Creates and compiles the conversation StateGraph.
 * Returns a compiled graph ready for invocation.
 */
export function createConversationGraph(config: ConversationGraphConfig) {
	const classifier = createIntentClassifier({ openaiApiKey: config.openaiApiKey });
	const classifyIntentNode = createClassifyIntentNode(classifier);

	const graph = new StateGraph(ConversationAnnotation)
		.addNode("classifyIntent", classifyIntentNode)
		.addNode("formatResponse", formatResponseNode)
		.addEdge(START, "classifyIntent")
		.addEdge("classifyIntent", "formatResponse")
		.addEdge("formatResponse", END);

	return graph.compile();
}
