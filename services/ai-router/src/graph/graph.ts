/**
 * LangGraph conversation graph.
 *
 * Topology: START -> loadContext -> classifyIntent -> formatResponse -> persistTurn -> END
 *
 * loadContext: Loads recent turn summaries and active pending command from DB.
 * classifyIntent: Invokes the LLM to classify the user's utterance with context.
 * formatResponse: Maps classification result to a GraphResponse.
 * persistTurn: Writes compressed turn summaries to DB (best-effort).
 */

import { END, START, StateGraph } from "@langchain/langgraph";
import type { Database } from "../db/connection.js";
import type { InsertTurnParams } from "../db/turn-repository.js";
import type { PendingCommandRow } from "../pending-command/repository.js";
import { createIntentClassifier } from "./llm.js";
import { createClassifyIntentNode } from "./nodes/classify-intent.js";
import { formatResponseNode } from "./nodes/format-response.js";
import { createLoadContextNode } from "./nodes/load-context.js";
import { createPersistTurnNode } from "./nodes/persist-turn.js";
import type { TurnSummary } from "./state.js";
import { ConversationAnnotation } from "./state.js";

export interface ConversationGraphConfig {
	openaiApiKey: string;
	db: Database;
	maxConversationTurns: number;
	getRecentTurns: (db: Database, userId: string, limit: number) => Promise<TurnSummary[]>;
	getActivePendingCommandForUser: (
		db: Database,
		userId: string,
	) => Promise<PendingCommandRow | null>;
	insertTurnSummary: (db: Database, params: InsertTurnParams) => Promise<unknown>;
	redactString: (value: string) => string;
}

/**
 * Creates and compiles the conversation StateGraph.
 * Returns a compiled graph ready for invocation.
 */
export function createConversationGraph(config: ConversationGraphConfig) {
	const classifier = createIntentClassifier({ openaiApiKey: config.openaiApiKey });
	const classifyIntentNode = createClassifyIntentNode(classifier);

	const loadContextNode = createLoadContextNode({
		db: config.db,
		maxTurns: config.maxConversationTurns,
		getRecentTurns: config.getRecentTurns,
		getActivePendingCommandForUser: config.getActivePendingCommandForUser,
	});

	const persistTurnNode = createPersistTurnNode({
		db: config.db,
		insertTurnSummary: config.insertTurnSummary,
		redactString: config.redactString,
	});

	const graph = new StateGraph(ConversationAnnotation)
		.addNode("loadContext", loadContextNode)
		.addNode("classifyIntent", classifyIntentNode)
		.addNode("formatResponse", formatResponseNode)
		.addNode("persistTurn", persistTurnNode)
		.addEdge(START, "loadContext")
		.addEdge("loadContext", "classifyIntent")
		.addEdge("classifyIntent", "formatResponse")
		.addEdge("formatResponse", "persistTurn")
		.addEdge("persistTurn", END);

	return graph.compile();
}
