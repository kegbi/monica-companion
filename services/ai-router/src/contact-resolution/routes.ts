import { createServiceClient, getCorrelationId, serviceAuth } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";
import { ContactResolutionRequest } from "@monica-companion/types";
import { Hono } from "hono";
import type { Config } from "../config.js";
import { requireUserId } from "../lib/require-user-id.js";
import { ContactResolutionClientError } from "./client.js";
import { resolveContact } from "./resolver.js";

const logger = createLogger("contact-resolution");

/**
 * Contact resolution routes.
 * POST /internal/resolve-contact -- callers: telegram-bridge
 */
export function contactResolutionRoutes(config: Config) {
	const routes = new Hono();

	const auth = serviceAuth({
		audience: "ai-router",
		secrets: config.auth.jwtSecrets,
		allowedCallers: ["telegram-bridge"],
	});

	routes.post("/resolve-contact", auth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = ContactResolutionRequest.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request" }, 400);
		}

		// Per MEDIUM-1: userId comes from JWT sub, not request body.
		// correlationId from request body is validated but we use the one from JWT context.
		const serviceClient = createServiceClient({
			issuer: "ai-router",
			audience: "monica-integration",
			secret: config.auth.jwtSecrets[0],
			baseUrl: config.monicaIntegrationUrl,
		});

		try {
			const result = await resolveContact(
				serviceClient,
				userId,
				parsed.data.contactRef,
				correlationId,
			);

			// Per MEDIUM-3: log outcome without PII (no contactRef or displayName in plain text)
			logger.info("Contact resolution completed", {
				outcome: result.outcome,
				candidateCount: result.candidates.length,
				correlationId,
			});

			return c.json(result);
		} catch (err) {
			if (err instanceof ContactResolutionClientError) {
				logger.error("Contact resolution service error", {
					correlationId,
					error: err.message,
				});
				return c.json({ error: "Contact resolution service unavailable" }, 502);
			}
			throw err;
		}
	});

	return routes;
}
