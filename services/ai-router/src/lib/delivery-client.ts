import type { ServiceClient } from "@monica-companion/auth";
import type { OutboundMessageIntent } from "@monica-companion/types";

export interface DeliveryClient {
	deliver(intent: OutboundMessageIntent): Promise<{ deliveryId: string; status: string }>;
}

export function createDeliveryClient(serviceClient: ServiceClient): DeliveryClient {
	return {
		async deliver(intent: OutboundMessageIntent) {
			const signal = AbortSignal.timeout(10_000);
			const res = await serviceClient.fetch("/internal/deliver", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(intent),
				correlationId: intent.correlationId,
				userId: intent.userId,
				signal,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => "unknown");
				throw new Error(`delivery returned ${res.status}: ${text}`);
			}

			return (await res.json()) as { deliveryId: string; status: string };
		},
	};
}
