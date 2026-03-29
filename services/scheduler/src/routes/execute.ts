import { getCorrelationId, serviceAuth } from "@monica-companion/auth";
import type { IdempotencyStore } from "@monica-companion/idempotency";
import { createLogger } from "@monica-companion/observability";
import { ConfirmedCommandPayloadSchema } from "@monica-companion/types";
import { trace } from "@opentelemetry/api";
import { Hono } from "hono";
import type { Config } from "../config";

const tracer = trace.getTracer("scheduler");
const logger = createLogger("scheduler:execute");

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
	/** When provided, commands with suppressDelivery are processed synchronously. */
	processSync?: (data: {
		executionId: string;
		command: unknown;
		correlationId: string;
	}) => Promise<void>;
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
				logger.error("Command payload validation failed", {
					correlationId: getCorrelationId(c),
					issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
				});
				span.setAttribute("scheduler.validation_error", true);
				span.end();
				return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
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

			const jobData = { executionId, command, correlationId };

			// When suppressDelivery is set (ai-router calls), process synchronously
			// so the caller gets the result before making follow-up tool calls.
			if (command.suppressDelivery && deps.processSync) {
				try {
					await deps.processSync(jobData);
					const completed = await idempotencyStore.check(command.idempotencyKey);

					logger.info("Command executed synchronously", {
						executionId,
						commandType: command.commandType,
						correlationId,
					});

					span.setAttribute("scheduler.execution_id", executionId);
					span.end();
					return c.json(
						{ executionId, status: "completed", result: completed?.result ?? null },
						200,
					);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					logger.error("Synchronous command execution failed", {
						executionId,
						commandType: command.commandType,
						correlationId,
						error: errMsg,
					});
					span.setAttribute("scheduler.error", errMsg);
					span.end();
					return c.json({ executionId, status: "failed", error: errMsg }, 500);
				}
			}

			// Otherwise, enqueue to BullMQ for async processing
			await commandQueue.add("execute-command", jobData);

			logger.info("Command queued for execution", {
				executionId,
				commandType: command.commandType,
				pendingCommandId: command.pendingCommandId,
				correlationId,
			});

			span.setAttribute("scheduler.execution_id", executionId);
			span.end();
			return c.json({ executionId, status: "queued" }, 202);
		});
	});

	return routes;
}
