import { getCorrelationId, serviceAuth } from "@monica-companion/auth";
import type { IdempotencyStore } from "@monica-companion/idempotency";
import { ConfirmedCommandPayloadSchema } from "@monica-companion/types";
import { trace } from "@opentelemetry/api";
import { Hono } from "hono";
import type { Config } from "../config";

const tracer = trace.getTracer("scheduler");

interface InsertChain {
	values: (data: Record<string, unknown>) => {
		returning: (cols: Record<string, unknown>) => Promise<Array<{ id: string }>>;
	};
}

interface ExecuteDeps {
	config: Config;
	idempotencyStore: IdempotencyStore;
	db: { insert: (table: unknown) => InsertChain };
	commandQueue: { add: (name: string, data: unknown) => Promise<unknown> };
}

export function executeRoutes(deps: ExecuteDeps) {
	const { config, idempotencyStore, db, commandQueue } = deps;
	const routes = new Hono();

	const aiRouterAuth = serviceAuth({
		audience: "scheduler",
		secrets: config.auth.jwtSecrets,
		allowedCallers: ["ai-router"],
	});

	routes.post("/execute", aiRouterAuth, async (c) => {
		return tracer.startActiveSpan("scheduler.execute_ingress", async (span) => {
			let body: unknown;
			try {
				body = await c.req.json();
			} catch {
				span.end();
				return c.json({ error: "Invalid request body" }, 400);
			}

			const parsed = ConfirmedCommandPayloadSchema.safeParse(body);
			if (!parsed.success) {
				span.end();
				return c.json({ error: "Invalid request body" }, 400);
			}

			const command = parsed.data;
			const correlationId = getCorrelationId(c);
			span.setAttribute("scheduler.command_type", command.commandType);
			span.setAttribute("scheduler.idempotency_key", command.idempotencyKey);

			// Check idempotency
			const existing = await idempotencyStore.check(command.idempotencyKey);
			if (existing) {
				if (existing.status === "completed") {
					span.setAttribute("scheduler.idempotency_hit", "completed");
					span.end();
					return c.json({ status: "completed", result: existing.result }, 200);
				}
				span.setAttribute("scheduler.idempotency_hit", "in_progress");
				span.end();
				return c.json({ error: "Command already in progress" }, 409);
			}

			// Claim idempotency key (TTL: 5 minutes for processing)
			const claimResult = await idempotencyStore.claim(command.idempotencyKey, 5 * 60 * 1000);
			if (!claimResult.claimed) {
				span.end();
				return c.json({ error: "Command already in progress" }, 409);
			}

			// Insert execution record
			const { commandExecutions } = await import("../db/schema");
			const insertResult = await db
				.insert(commandExecutions)
				.values({
					pendingCommandId: command.pendingCommandId,
					idempotencyKey: command.idempotencyKey,
					userId: command.userId,
					commandType: command.commandType,
					payload: command.payload,
					status: "queued",
					correlationId,
				})
				.returning({ id: commandExecutions.id });

			const executionId = insertResult[0].id;

			// Enqueue to BullMQ
			await commandQueue.add("execute-command", {
				executionId,
				command,
				correlationId,
			});

			span.setAttribute("scheduler.execution_id", executionId);
			span.end();
			return c.json({ executionId, status: "queued" }, 202);
		});
	});

	return routes;
}
