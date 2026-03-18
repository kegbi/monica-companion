import type { ServiceClient } from "@monica-companion/auth";
import type { StructuredLogger } from "@monica-companion/observability";
import { redactObject } from "@monica-companion/redaction";
import { trace } from "@opentelemetry/api";
import { sql } from "drizzle-orm";

const tracer = trace.getTracer("scheduler");

export interface DeadLetterDeps {
	deliveryClient: ServiceClient;
	db: { execute: (query: unknown) => Promise<unknown> };
	logger: StructuredLogger;
}

export interface DeadLetterPayload {
	jobId: string;
	queue: string;
	executionId: string;
	userId: string;
	correlationId: string;
	connectorType: string;
	connectorRoutingId: string;
	error: string;
	attemptCount: number;
	payload: unknown;
}

/**
 * Handles a dead-letter event: redacts sensitive data from the payload,
 * logs the event, updates execution status, and sends an error notification.
 */
export async function handleDeadLetter(
	data: DeadLetterPayload,
	deps: DeadLetterDeps,
): Promise<void> {
	await tracer.startActiveSpan("scheduler.dead_letter", async (span) => {
		span.setAttribute("scheduler.job_id", data.jobId);
		span.setAttribute("scheduler.queue", data.queue);
		span.setAttribute("scheduler.execution_id", data.executionId);
		span.setAttribute("scheduler.attempt_count", data.attemptCount);

		try {
			// Redact the payload before logging
			const redactedPayload = redactObject(data.payload);

			deps.logger.error("Dead letter: job exhausted all retries", {
				jobId: data.jobId,
				queue: data.queue,
				executionId: data.executionId,
				attemptCount: data.attemptCount,
				error: data.error,
				payload: JSON.stringify(redactedPayload),
			});

			// Update execution status to dead_lettered
			await deps.db.execute(
				sql`UPDATE command_executions
					SET status = 'dead_lettered', last_error = ${data.error}, updated_at = NOW()
					WHERE id = ${data.executionId}::uuid`,
			);

			// Send error notification to delivery (best-effort)
			try {
				await deps.deliveryClient.fetch("/internal/deliver", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						userId: data.userId,
						connectorType: data.connectorType,
						connectorRoutingId: data.connectorRoutingId,
						correlationId: data.correlationId,
						content: {
							type: "error",
							text: "A command could not be completed after multiple attempts. Please try again later.",
						},
					}),
					userId: data.userId,
					correlationId: data.correlationId,
				});
			} catch {
				deps.logger.warn("Failed to send dead-letter notification to delivery", {
					executionId: data.executionId,
				});
			}
		} finally {
			span.end();
		}
	});
}
