/**
 * LangGraph conversation graph.
 *
 * Topology: START -> loadContext -> classifyIntent -> executeAction -> formatResponse -> deliverResponse -> persistTurn -> END
 *
 * loadContext: Loads recent turn summaries and active pending command from DB.
 * classifyIntent: Invokes the LLM to classify the user's utterance with context.
 * executeAction: Creates/transitions pending commands, sends to scheduler, handles callbacks.
 * formatResponse: Maps classification + action outcome to a GraphResponse.
 * deliverResponse: Sends the formatted response to delivery service (best-effort).
 * persistTurn: Writes compressed turn summaries to DB (best-effort).
 */

import { END, START, StateGraph } from "@langchain/langgraph";
import type { MutatingCommandPayload, PendingCommandStatus } from "@monica-companion/types";
import type { Database } from "../db/connection.js";
import type { InsertTurnParams } from "../db/turn-repository.js";
import type { DeliveryClient } from "../lib/delivery-client.js";
import type { SchedulerClient } from "../lib/scheduler-client.js";
import type { UserManagementClient } from "../lib/user-management-client.js";
import { buildConfirmedPayload } from "../pending-command/confirm.js";
import type { PendingCommandRow } from "../pending-command/repository.js";
import { createIntentClassifier } from "./llm.js";
import { createClassifyIntentNode } from "./nodes/classify-intent.js";
import { createDeliverResponseNode } from "./nodes/deliver-response.js";
import { createExecuteActionNode } from "./nodes/execute-action.js";
import { formatResponseNode } from "./nodes/format-response.js";
import { createLoadContextNode } from "./nodes/load-context.js";
import { createPersistTurnNode } from "./nodes/persist-turn.js";
import type { TurnSummary } from "./state.js";
import { ConversationAnnotation } from "./state.js";

export interface ConversationGraphConfig {
	openaiApiKey: string;
	db: Database;
	maxConversationTurns: number;
	pendingCommandTtlMinutes: number;
	autoConfirmConfidenceThreshold: number;
	getRecentTurns: (db: Database, userId: string, limit: number) => Promise<TurnSummary[]>;
	getActivePendingCommandForUser: (
		db: Database,
		userId: string,
	) => Promise<PendingCommandRow | null>;
	insertTurnSummary: (db: Database, params: InsertTurnParams) => Promise<unknown>;
	redactString: (value: string) => string;
	createPendingCommand: (
		db: Database,
		params: {
			userId: string;
			commandType: string;
			payload: MutatingCommandPayload;
			sourceMessageRef: string;
			correlationId: string;
			ttlMinutes: number;
		},
	) => Promise<PendingCommandRow>;
	transitionStatus: (
		db: Database,
		id: string,
		expectedVersion: number,
		from: PendingCommandStatus,
		to: PendingCommandStatus,
	) => Promise<PendingCommandRow | null>;
	getPendingCommand: (db: Database, id: string) => Promise<PendingCommandRow | null>;
	schedulerClient: SchedulerClient;
	deliveryClient: DeliveryClient;
	userManagementClient: UserManagementClient;
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

	const executeActionNode = createExecuteActionNode({
		db: config.db,
		pendingCommandTtlMinutes: config.pendingCommandTtlMinutes,
		autoConfirmConfidenceThreshold: config.autoConfirmConfidenceThreshold,
		createPendingCommand: config.createPendingCommand,
		transitionStatus: config.transitionStatus,
		getPendingCommand: config.getPendingCommand,
		buildConfirmedPayload,
		schedulerClient: config.schedulerClient,
		userManagementClient: config.userManagementClient,
	});

	const deliverResponseNode = createDeliverResponseNode({
		deliveryClient: config.deliveryClient,
		userManagementClient: config.userManagementClient,
	});

	const persistTurnNode = createPersistTurnNode({
		db: config.db,
		insertTurnSummary: config.insertTurnSummary,
		redactString: config.redactString,
	});

	const graph = new StateGraph(ConversationAnnotation)
		.addNode("loadContext", loadContextNode)
		.addNode("classifyIntent", classifyIntentNode)
		.addNode("executeAction", executeActionNode)
		.addNode("formatResponse", formatResponseNode)
		.addNode("deliverResponse", deliverResponseNode)
		.addNode("persistTurn", persistTurnNode)
		.addEdge(START, "loadContext")
		.addEdge("loadContext", "classifyIntent")
		.addEdge("classifyIntent", "executeAction")
		.addEdge("executeAction", "formatResponse")
		.addEdge("formatResponse", "deliverResponse")
		.addEdge("deliverResponse", "persistTurn")
		.addEdge("persistTurn", END);

	return graph.compile();
}
