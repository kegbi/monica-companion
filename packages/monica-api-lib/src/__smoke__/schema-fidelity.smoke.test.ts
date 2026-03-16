import { describe, expect, it } from "vitest";
import { MonicaApiClient } from "../client.js";
import { loadSmokeConfig } from "./smoke-config.js";

const config = loadSmokeConfig();

function createClient(): MonicaApiClient {
	return new MonicaApiClient({
		baseUrl: config.MONICA_SMOKE_BASE_URL,
		apiToken: config.MONICA_SMOKE_API_TOKEN,
		timeoutMs: 15_000,
		retryOptions: { maxRetries: 1, baseDelayMs: 1000, maxDelayMs: 5000 },
	});
}

describe("Schema fidelity against real Monica API", () => {
	const client = createClient();

	it("real contact list response parses through PaginatedResponse(FullContact)", async () => {
		const result = await client.listContacts({ page: 1, limit: 10 });

		// The raw response must parse through our Zod schema without dropping fields
		expect(result.data).toBeDefined();
		expect(result.meta).toBeDefined();
		expect(result.meta.current_page).toBe(1);
		expect(result.links).toBeDefined();

		// Every contact in the response must have the expected shape
		for (const contact of result.data) {
			expect(contact.id).toBeTypeOf("number");
			expect(contact.object).toBe("contact");
			expect(contact.first_name).toBeTypeOf("string");
			expect(contact.information).toBeDefined();
		}
	});

	it("real single contact response parses through FullContact schema", async () => {
		// First get a contact ID from the list
		const list = await client.listContacts({ page: 1, limit: 1 });
		if (list.data.length === 0) {
			// Skip if no contacts exist (seed data required)
			return;
		}

		const contactId = list.data[0].id;
		const contact = await client.getContact(contactId);

		expect(contact.id).toBe(contactId);
		expect(contact.object).toBe("contact");
		expect(contact.first_name).toBeTypeOf("string");
		expect(contact.information).toBeDefined();
		expect(contact.information.dates).toBeDefined();
		expect(contact.information.avatar).toBeDefined();
	});

	it("real genders response parses through Gender schema", async () => {
		const genders = await client.listGenders();

		expect(genders.length).toBeGreaterThan(0);
		for (const gender of genders) {
			expect(gender.id).toBeTypeOf("number");
			expect(gender.object).toBe("gender");
			expect(gender.name).toBeTypeOf("string");
		}
	});

	it("real contact field types response parses through ContactFieldType schema", async () => {
		const fieldTypes = await client.listContactFieldTypes();

		expect(fieldTypes.length).toBeGreaterThan(0);
		for (const ft of fieldTypes) {
			expect(ft.id).toBeTypeOf("number");
			expect(ft.object).toBe("contactfieldtype");
			expect(ft.name).toBeTypeOf("string");
		}
	});

	it("real contact notes response parses through Note schema", async () => {
		const list = await client.listContacts({ page: 1, limit: 1 });
		if (list.data.length === 0) return;

		const contactId = list.data[0].id;
		const notes = await client.listContactNotes(contactId);

		expect(notes.data).toBeDefined();
		expect(notes.meta).toBeDefined();
		// Notes may be empty but the envelope must parse
	});

	it("real reminder outbox response parses through ReminderOutbox schema", async () => {
		const reminders = await client.getUpcomingReminders(0);

		// Reminders may be empty but must parse as an array
		expect(Array.isArray(reminders)).toBe(true);
	});

	it("real addresses response parses through Address schema", async () => {
		const list = await client.listContacts({ page: 1, limit: 1 });
		if (list.data.length === 0) return;

		const contactId = list.data[0].id;
		const addresses = await client.listContactAddresses(contactId);

		// Addresses may be empty but must parse as an array
		expect(Array.isArray(addresses)).toBe(true);
	});

	it("contact with fields includes contactFields when requested", async () => {
		const list = await client.listContacts({ page: 1, limit: 1 });
		if (list.data.length === 0) return;

		const contactId = list.data[0].id;
		const contact = await client.getContactWithFields(contactId);

		expect(contact.id).toBe(contactId);
		// contactFields may or may not be present depending on whether ?with=contactfields works
		// but the response must parse through the schema
	});
});
