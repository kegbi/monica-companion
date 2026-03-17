import { createServiceClient, serviceAuth } from "@monica-companion/auth";
import { otelMiddleware } from "@monica-companion/observability";
import { OutboundMessageIntentSchema } from "@monica-companion/types";
import { Hono } from "hono";
import type { Config } from "./config";

const CONNECTOR_URL_MAP: Record<string, (config: Config) => string> = {
	telegram: (config) => config.telegramBridgeUrl,
};

export function createApp(config: Config) {
	const app = new Hono();

	app.use(otelMiddleware());

	app.get("/health", (c) => c.json({ status: "ok", service: "delivery" }));

	const internal = new Hono();
	internal.use(
		serviceAuth({
			audience: "delivery",
			secrets: config.auth.jwtSecrets,
			allowedCallers: ["ai-router", "scheduler"],
		}),
	);

	internal.post("/deliver", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = OutboundMessageIntentSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid payload" }, 400);
		}

		const intent = parsed.data;
		const urlResolver = CONNECTOR_URL_MAP[intent.connectorType];
		if (!urlResolver) {
			return c.json({ error: "Unsupported connector type" }, 400);
		}

		const connectorBaseUrl = urlResolver(config);
		const connectorClient = createServiceClient({
			issuer: "delivery",
			audience: intent.connectorType === "telegram" ? "telegram-bridge" : "telegram-bridge",
			secret: config.auth.jwtSecrets[0],
			baseUrl: connectorBaseUrl,
			fetch: config.fetchFn,
		});

		try {
			const res = await connectorClient.fetch("/internal/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(intent),
				correlationId: intent.correlationId,
				userId: intent.userId,
			});

			const responseBody = await res.json();
			return c.json(responseBody, res.status as 200);
		} catch {
			return c.json({ error: "Failed to deliver message" }, 502);
		}
	});

	app.route("/internal", internal);

	return app;
}
