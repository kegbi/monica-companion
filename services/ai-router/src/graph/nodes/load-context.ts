/**
 * loadContext graph node.
 *
 * Loads recent conversation turn summaries and the active pending command
 * from the database into graph state, enabling the LLM to resolve
 * pronouns, follow-up references, and draft command attachments.
 */

import { trace } from "@opentelemetry/api";
import type { Database } from "../../db/connection.js";
import type { PendingCommandRow } from "../../pending-command/repository.js";
import type { ConversationAnnotation, PendingCommandRef, TurnSummary } from "../state.js";

const tracer = trace.getTracer("ai-router");

type State = typeof ConversationAnnotation.State;
type Update = typeof ConversationAnnotation.Update;

export interface LoadContextDeps {
	db: Database;
	maxTurns: number;
	getRecentTurns: (db: Database, userId: string, limit: number) => Promise<TurnSummary[]>;
	getActivePendingCommandForUser: (
		db: Database,
		userId: string,
	) => Promise<PendingCommandRow | null>;
}

/**
 * Creates a loadContext node function with injected dependencies.
 */
export function createLoadContextNode(deps: LoadContextDeps) {
	return async function loadContextNode(state: State): Promise<Update> {
		return tracer.startActiveSpan("ai-router.graph.load_context", async (span) => {
			try {
				const [recentTurns, activeCommand] = await Promise.all([
					deps.getRecentTurns(deps.db, state.userId, deps.maxTurns),
					deps.getActivePendingCommandForUser(deps.db, state.userId),
				]);

				const activePendingCommand: PendingCommandRef | null = activeCommand
					? {
							pendingCommandId: activeCommand.id,
							version: activeCommand.version,
							status: activeCommand.status,
							commandType: activeCommand.commandType,
						}
					: null;

				return {
					recentTurns,
					activePendingCommand,
				};
			} finally {
				span.end();
			}
		});
	};
}
