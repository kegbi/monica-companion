import { getCorrelationId, serviceAuth } from "@monica-companion/auth";
import { Hono } from "hono";
import type { Config } from "../config.js";
import { requireUserId } from "../lib/require-user-id.js";
import { createMonicaClient, handleMonicaError } from "./shared.js";

/**
 * Reference data endpoints.
 * These return Monica reference data needed for contact creation.
 * All callers: scheduler only.
 */
export function referenceRoutes(config: Config) {
	const routes = new Hono();

	const schedulerAuth = serviceAuth({
		audience: "monica-integration",
		secrets: config.auth.jwtSecrets,
		allowedCallers: ["scheduler"],
	});

	routes.use(schedulerAuth);

	// --- Genders ---
	routes.get("/genders", async (c) => {
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

	// --- Contact field types ---
	routes.get("/contact-field-types", async (c) => {
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
