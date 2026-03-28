import { getCorrelationId, serviceAuth } from "@monica-companion/auth";
import { Hono } from "hono";
import { z } from "zod/v4";
import type { Config } from "../config.js";
import { requireUserId } from "../lib/require-user-id.js";
import { createMonicaClient, handleMonicaError } from "./shared.js";

// ── Internal request schemas (Monica-agnostic) ──────────────────────

const CreateContactBody = z.object({
	firstName: z.string().max(50),
	lastName: z.string().max(100).optional(),
	nickname: z.string().max(100).optional(),
	genderId: z.number().int(),
	birthdate: z
		.object({
			day: z.number().int(),
			month: z.number().int(),
			year: z.number().int().optional(),
			isAgeBased: z.boolean().optional(),
			age: z.number().int().optional(),
		})
		.optional(),
});

const UpdateContactBody = z.object({
	firstName: z.string().max(50).optional(),
	lastName: z.string().max(100).optional(),
	nickname: z.string().max(100).optional(),
	genderId: z.number().int().optional(),
	birthdate: z
		.object({
			day: z.number().int(),
			month: z.number().int(),
			year: z.number().int().optional(),
			isAgeBased: z.boolean().optional(),
			age: z.number().int().optional(),
		})
		.optional(),
});

const CreateNoteBody = z.object({
	body: z.string().max(100000),
});

const CreateActivityBody = z.object({
	summary: z.string().max(255),
	description: z.string().max(1000000).optional(),
	happenedAt: z.string(),
	contactIds: z.array(z.number().int()),
	activityTypeId: z.number().int().nullable().optional(),
});

const CreateContactFieldBody = z.object({
	value: z.string().max(255),
	type: z.enum(["email", "phone"]),
	/**
	 * Monica contact_field_type_id. This is a known boundary leak from the
	 * Monica domain into the internal contract. Accepted for V1 pragmatism;
	 * a future version should map type strings to IDs within monica-integration.
	 */
	contactFieldTypeId: z.number().int(),
});

const CreateAddressBody = z.object({
	name: z.string().optional(),
	street: z.string().nullable().optional(),
	city: z.string().nullable().optional(),
	province: z.string().nullable().optional(),
	postalCode: z.string().nullable().optional(),
	country: z.string(),
});

/**
 * Write/execution endpoints.
 * All callers: scheduler only.
 * Per-endpoint caller allowlists (no global route-level auth to avoid
 * leaking middleware to sibling route groups when Hono merges routes).
 */
export function writeRoutes(config: Config) {
	const routes = new Hono();

	const schedulerAuth = serviceAuth({
		audience: "monica-integration",
		secrets: config.auth.jwtSecrets,
		allowedCallers: ["scheduler"],
	});

	// --- Create contact ---
	routes.post("/contacts", schedulerAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = CreateContactBody.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request body" }, 400);
		}

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const { firstName, lastName, nickname, genderId, birthdate } = parsed.data;

			const contact = await client.createContact({
				first_name: firstName,
				last_name: lastName,
				nickname,
				gender_id: genderId,
				is_birthdate_known: !!birthdate,
				birthdate_day: birthdate?.day,
				birthdate_month: birthdate?.month,
				birthdate_year: birthdate?.year,
				birthdate_is_age_based: birthdate?.isAgeBased,
				birthdate_age: birthdate?.age,
				is_deceased: false,
				is_deceased_date_known: false,
			});

			return c.json({ contactId: contact.id, displayName: contact.complete_name }, 201);
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	// --- Update contact ---
	routes.put("/contacts/:contactId", schedulerAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);
		const contactId = Number(c.req.param("contactId"));

		if (!Number.isFinite(contactId) || contactId <= 0) {
			return c.json({ error: "Invalid contactId" }, 400);
		}

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = UpdateContactBody.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request body" }, 400);
		}

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const { firstName, lastName, nickname, genderId, birthdate } = parsed.data;

			// Fetch existing contact to preserve required fields for the Monica PUT API
			const [existing, genders] = await Promise.all([
				client.getContact(contactId),
				client.listGenders(),
			]);

			const genderMatch = genders.find((g) => g.type === existing.gender_type);
			const resolvedGenderId = genderId ?? genderMatch?.id ?? genders[0]?.id ?? 3;
			const existingHasBirthdate = !!existing.information.dates.birthdate.date;

			const contact = await client.updateContact(contactId, {
				first_name: firstName ?? existing.first_name,
				last_name: lastName ?? existing.last_name,
				nickname: nickname ?? existing.nickname,
				gender_id: resolvedGenderId,
				is_birthdate_known: birthdate ? true : existingHasBirthdate,
				birthdate_day: birthdate?.day,
				birthdate_month: birthdate?.month,
				birthdate_year: birthdate?.year,
				birthdate_is_age_based: birthdate?.isAgeBased,
				birthdate_age: birthdate?.age,
				is_deceased: existing.is_dead,
				is_deceased_date_known: false,
			});

			return c.json({
				contactId: contact.id,
				displayName: contact.complete_name,
			});
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	// --- Create note ---
	routes.post("/contacts/:contactId/notes", schedulerAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);
		const contactId = Number(c.req.param("contactId"));

		if (!Number.isFinite(contactId) || contactId <= 0) {
			return c.json({ error: "Invalid contactId" }, 400);
		}

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = CreateNoteBody.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request body" }, 400);
		}

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const note = await client.createNote({
				body: parsed.data.body,
				contact_id: contactId,
			});

			return c.json({ noteId: note.id }, 201);
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	// --- Create activity ---
	routes.post("/activities", schedulerAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = CreateActivityBody.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request body" }, 400);
		}

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const activity = await client.createActivity({
				summary: parsed.data.summary,
				description: parsed.data.description,
				happened_at: parsed.data.happenedAt,
				contacts: parsed.data.contactIds,
				activity_type_id: parsed.data.activityTypeId,
			});

			return c.json({ activityId: activity.id }, 201);
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	// --- Create contact field ---
	routes.post("/contacts/:contactId/contact-fields", schedulerAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);
		const contactId = Number(c.req.param("contactId"));

		if (!Number.isFinite(contactId) || contactId <= 0) {
			return c.json({ error: "Invalid contactId" }, 400);
		}

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = CreateContactFieldBody.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request body" }, 400);
		}

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const field = await client.createContactField({
				data: parsed.data.value,
				contact_field_type_id: parsed.data.contactFieldTypeId,
				contact_id: contactId,
			});

			return c.json({ contactFieldId: field.id }, 201);
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	// --- Create address ---
	routes.post("/contacts/:contactId/addresses", schedulerAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);
		const contactId = Number(c.req.param("contactId"));

		if (!Number.isFinite(contactId) || contactId <= 0) {
			return c.json({ error: "Invalid contactId" }, 400);
		}

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = CreateAddressBody.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request body" }, 400);
		}

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const address = await client.createAddress({
				name: parsed.data.name,
				street: parsed.data.street,
				city: parsed.data.city,
				province: parsed.data.province,
				postal_code: parsed.data.postalCode,
				country: parsed.data.country,
				contact_id: contactId,
			});

			return c.json({ addressId: address.id }, 201);
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	// --- Update contact nickname ---
	const UpdateNicknameBody = z.object({
		nickname: z.string().max(100),
	});

	routes.put("/contacts/:contactId/nickname", schedulerAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);
		const contactId = Number(c.req.param("contactId"));

		if (!Number.isFinite(contactId) || contactId <= 0) {
			return c.json({ error: "Invalid contactId" }, 400);
		}

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const parsed = UpdateNicknameBody.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request body" }, 400);
		}

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			// Fetch existing contact + genders to preserve required fields for the Monica PUT
			const [existing, genders] = await Promise.all([
				client.getContact(contactId),
				client.listGenders(),
			]);

			const genderMatch = genders.find((g) => g.type === existing.gender_type);
			const genderId = genderMatch?.id ?? genders[0]?.id ?? 3;

			const newNickname = parsed.data.nickname.length > 0 ? parsed.data.nickname : undefined;

			const contact = await client.updateContact(contactId, {
				first_name: existing.first_name,
				last_name: existing.last_name,
				nickname: newNickname,
				gender_id: genderId,
				is_birthdate_known: false,
				is_deceased: existing.is_dead,
				is_deceased_date_known: false,
			});

			return c.json({
				contactId: contact.id,
				displayName: contact.complete_name,
				nickname: contact.nickname,
			});
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	// --- Delete contact ---
	routes.delete("/contacts/:contactId", schedulerAuth, async (c) => {
		const userId = requireUserId(c);
		const correlationId = getCorrelationId(c);
		const contactId = Number(c.req.param("contactId"));

		if (!Number.isFinite(contactId) || contactId <= 0) {
			return c.json({ error: "Invalid contactId" }, 400);
		}

		try {
			const client = await createMonicaClient(config, userId, correlationId);
			const result = await client.deleteContact(contactId);
			return c.json({ deleted: result.deleted, contactId: result.id });
		} catch (err) {
			return handleMonicaError(c, err);
		}
	});

	return routes;
}
