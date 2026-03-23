import { createServiceClient } from "@monica-companion/auth";
import type { InboundEvent } from "@monica-companion/types";

export interface AiRouterClientOptions {
	baseUrl: string;
	secret: string;
	timeoutMs?: number;
}

export interface AiRouterClient {
	forwardEvent(event: InboundEvent): Promise<void>;
	clearHistory(userId: string): Promise<{ cleared: boolean }>;
}

export function createAiRouterClient(options: AiRouterClientOptions): AiRouterClient {
	const client = createServiceClient({
		issuer: "telegram-bridge",
		audience: "ai-router",
		secret: options.secret,
		baseUrl: options.baseUrl,
	});

	return {
		async forwardEvent(event: InboundEvent): Promise<void> {
			const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
			const res = await client.fetch("/internal/process", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
				correlationId: event.correlationId,
				userId: event.userId,
				signal,
			});
			if (!res.ok) {
				throw new Error(`ai-router returned ${res.status}`);
			}
		},

		async clearHistory(userId: string): Promise<{ cleared: boolean }> {
			const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
			const res = await client.fetch("/internal/clear-history", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userId }),
				correlationId: `clear-history-${Date.now()}`,
				userId,
				signal,
			});
			if (!res.ok) {
				throw new Error(`ai-router clear-history returned ${res.status}`);
			}
			return (await res.json()) as { cleared: boolean };
		},
	};
}
