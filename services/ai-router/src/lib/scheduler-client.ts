import type { ServiceClient } from "@monica-companion/auth";
import type { ConfirmedCommandPayload } from "@monica-companion/types";

export interface SchedulerClient {
	execute(
		payload: ConfirmedCommandPayload,
	): Promise<{ executionId: string; status: string; result?: unknown }>;
}

export function createSchedulerClient(serviceClient: ServiceClient): SchedulerClient {
	return {
		async execute(payload: ConfirmedCommandPayload) {
			const signal = AbortSignal.timeout(10_000);
			const res = await serviceClient.fetch("/internal/execute", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
				correlationId: payload.correlationId,
				userId: payload.userId,
				signal,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => "unknown");
				throw new Error(`scheduler returned ${res.status}: ${text}`);
			}

			return (await res.json()) as { executionId: string; status: string; result?: unknown };
		},
	};
}
