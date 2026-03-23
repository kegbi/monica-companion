import { getCorrelationId, serviceAuth } from "@monica-companion/auth";
import { ContactField } from "@monica-companion/monica-api-lib";
import { Hono } from "hono";
import type { Config } from "../config.js";
import {
	buildContactResolutionSummaries,
	buildContactResolutionSummary,
} from "../lib/contact-projection.js";
import { requireUserId } from "../lib/require-user-id.js";
import { createMonicaClient, handleMonicaError } from "./shared.js";

/**
 * Read-only endpoints.
 * - GET /contacts/resolution-summaries -- callers: ai-router
 * - GET /contacts/:contactId -- callers: ai-router, scheduler
 * - GET /contacts/:contactId/notes -- callers: ai-router
 * - GET /reminders/upcoming -- callers: scheduler
 */
export function readRoutes(config: Config) {
	const routes = new Hono();

	// --- Resolution summaries (ai-router only) ---
	const aiRouterAuth = serviceAuth({
		audience: "monica-integration",
		secrets: config.auth.jwtSecrets,
		allowedCallers: ["ai-router"],
	});

	routes.get("/contacts/resolution-summaries", aiRouterAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const contacts = await client.getAllContacts();
			const summaries = buildContactResolutionSummaries(contacts);
			return c.json({ data: summaries });
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	// --- Single contact detail & notes (ai-router + scheduler) ---
	const readContactAuth = serviceAuth({
		audience: "monica-integration",
		secrets: config.auth.jwtSecrets,
		allowedCallers: ["ai-router", "scheduler"],
	});

	routes.get("/contacts/:contactId", readContactAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);
		const contactId = Number(c.req.param("contactId"));

		if (!Number.isFinite(contactId) || contactId <= 0) {
			return c.json({ error: "Invalid contactId" }, 400);
		}

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const contact = await client.getContact(contactId);
			const summary = buildContactResolutionSummary(contact);
			return c.json(summary);
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	// Notes sub-endpoint also uses ai-router auth
	routes.get("/contacts/:contactId/notes", aiRouterAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);
		const contactId = Number(c.req.param("contactId"));

		if (!Number.isFinite(contactId) || contactId <= 0) {
			return c.json({ error: "Invalid contactId" }, 400);
		}

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const page = Number(c.req.query("page")) || 1;
			const limit = Number(c.req.query("limit")) || 15;
			const result = await client.listContactNotes(contactId, { page, limit });
			return c.json({
				data: result.data.map((note) => ({
					noteId: note.id,
					body: note.body,
					isFavorited: note.is_favorited,
					createdAt: note.created_at,
				})),
			});
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	// --- Contact fields (ai-router only) ---
	routes.get("/contacts/:contactId/contact-fields", aiRouterAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);
		const contactId = Number(c.req.param("contactId"));

		if (!Number.isFinite(contactId) || contactId <= 0) {
			return c.json({ error: "Invalid contactId" }, 400);
		}

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const contact = await client.getContactWithFields(contactId);
			const rawFields = contact.contactFields ?? [];

			const fields = rawFields
				.map((raw) => ContactField.safeParse(raw))
				.filter((r): r is { success: true; data: typeof ContactField._type } => r.success === true)
				.map((r) => ({
					fieldId: r.data.id,
					type: r.data.contact_field_type.type,
					typeName: r.data.contact_field_type.name,
					typeId: r.data.contact_field_type.id,
					value: r.data.content,
				}));

			return c.json({ data: fields });
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	// --- Upcoming reminders (scheduler only) ---
	const schedulerAuth = serviceAuth({
		audience: "monica-integration",
		secrets: config.auth.jwtSecrets,
		allowedCallers: ["scheduler"],
	});

	routes.get("/reminders/upcoming", schedulerAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);
		const monthOffset = Number(c.req.query("monthOffset")) || 0;

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const reminders = await client.getUpcomingReminders(monthOffset);
			return c.json({
				data: reminders.map((r) => ({
					reminderId: r.reminder_id,
					plannedDate: r.planned_date,
					title: r.title,
					description: r.description,
					contactId: r.contact.id,
					contactName: r.contact.complete_name,
				})),
			});
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	return routes;
}
