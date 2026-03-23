import { getCorrelationId, serviceAuth } from "@monica-companion/auth";
import { Hono } from "hono";
import type { Config } from "../config.js";
import { requireUserId } from "../lib/require-user-id.js";
import { createMonicaClient, handleMonicaError } from "./shared.js";

/**
 * Reference data endpoints.
 * These return Monica reference data needed for contact creation.
 * Per-endpoint caller allowlists (M1 fix: no global route-level auth).
 */
export function referenceRoutes(config: Config) {
	const routes = new Hono();

	const schedulerOnlyAuth = serviceAuth({
		audience: "monica-integration",
		secrets: config.auth.jwtSecrets,
		allowedCallers: ["scheduler"],
	});

	const schedulerAndAiRouterAuth = serviceAuth({
		audience: "monica-integration",
		secrets: config.auth.jwtSecrets,
		allowedCallers: ["scheduler", "ai-router"],
	});

	// --- Genders (scheduler only) ---
	routes.get("/genders", schedulerOnlyAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const genders = await client.listGenders();
			return c.json({
				data: genders.map((g) => ({
					id: g.id,
					name: g.name,
					type: g.type,
				})),
			});
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	// --- Contact field types (scheduler + ai-router) ---
	routes.get("/contact-field-types", schedulerAndAiRouterAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const types = await client.listContactFieldTypes();
			return c.json({
				data: types.map((t) => ({
					id: t.id,
					name: t.name,
					type: t.type,
				})),
			});
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	return routes;
}
