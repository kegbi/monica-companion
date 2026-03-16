import { getCorrelationId, serviceAuth } from "@monica-companion/auth";
import { MonicaApiError } from "@monica-companion/monica-api-lib";
import { Hono } from "hono";
import type { Config } from "../config.js";
import { requireUserId } from "../lib/require-user-id.js";
import { createMonicaClient } from "./shared.js";

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

function handleMonicaError(c: import("hono").Context, err: unknown) {
	if (err instanceof MonicaApiError) {
		const status = err.statusCode >= 500 ? 502 : err.statusCode;
		return c.json({ error: "Monica API error" }, status as 400);
	}
	if (err instanceof Error && err.name === "CredentialResolutionError") {
		return c.json({ error: "Failed to resolve user credentials" }, 502);
	}
	throw err;
}
