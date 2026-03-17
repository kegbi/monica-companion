import type { ServiceClient } from "@monica-companion/auth";
import type { IdempotencyStore } from "@monica-companion/idempotency";
import type { ConfirmedCommandPayload } from "@monica-companion/types";
import { trace } from "@opentelemetry/api";
import { mapCommandToMonicaRequest } from "../lib/command-mapper";

const tracer = trace.getTracer("scheduler");

export interface CommandWorkerDeps {
	monicaClient: ServiceClient;
	deliveryClient: ServiceClient;
	idempotencyStore: IdempotencyStore;
	db: { execute: (query: unknown) => Promise<unknown> };
}

export interface CommandJobData {
	executionId: string;
	command: ConfirmedCommandPayload;
	correlationId: string;
}

/**
 * Processes a single command execution job. Called by the BullMQ worker.
 * On success, completes the idempotency key and emits a delivery intent.
 * On failure, throws to trigger BullMQ retry.
 */
export async function processCommandJob(
	data: CommandJobData,
	deps: CommandWorkerDeps,
): Promise<void> {
	const { executionId, command, correlationId } = data;

	await tracer.startActiveSpan("scheduler.execute_command", async (span) => {
		span.setAttribute("scheduler.execution_id", executionId);
		span.setAttribute("scheduler.command_type", command.commandType);
		span.setAttribute("scheduler.correlation_id", correlationId);

		try {
			const request = mapCommandToMonicaRequest(command.payload);

			const response = await deps.monicaClient.fetch(request.path, {
				method: request.method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request.body),
				userId: command.userId,
				correlationId,
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => "unknown error");
				span.setAttribute("scheduler.error", errorText);
				throw new Error(`monica-integration returned ${response.status}: ${errorText}`);
			}

			const result = await response.json();

			// Complete idempotency key
			await deps.idempotencyStore.complete(command.idempotencyKey, result);

			// Send success delivery intent (best-effort, don't block on failure)
			try {
				await deps.deliveryClient.fetch("/internal/deliver", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						userId: command.userId,
						connectorType: "telegram",
						connectorRoutingId: "",
						correlationId,
						content: {
							type: "text",
							text: `Command ${command.commandType} completed successfully.`,
						},
					}),
					userId: command.userId,
					correlationId,
				});
			} catch {
				// Delivery failure is non-critical; the command still succeeded
				span.setAttribute("scheduler.delivery_failed", true);
			}

			span.setAttribute("scheduler.status", "completed");
		} catch (err) {
			span.setAttribute("scheduler.status", "failed");
			if (err instanceof Error) {
				span.setAttribute("scheduler.error", err.message);
			}
			throw err;
		} finally {
			span.end();
		}
	});
}
