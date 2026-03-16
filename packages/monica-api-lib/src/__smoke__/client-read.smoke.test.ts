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

describe("MonicaApiClient read operations against real instance", () => {
	const client = createClient();

	describe("listContacts", () => {
		it("returns a paginated response with contacts", async () => {
			const result = await client.listContacts({ page: 1, limit: 10 });

			expect(result.data).toBeDefined();
			expect(Array.isArray(result.data)).toBe(true);
			expect(result.meta.current_page).toBe(1);
			expect(result.meta.last_page).toBeGreaterThanOrEqual(1);
		});

		it("respects pagination parameters", async () => {
			const page1 = await client.listContacts({ page: 1, limit: 2 });
			expect(page1.meta.current_page).toBe(1);

			if (page1.meta.last_page > 1) {
				const page2 = await client.listContacts({ page: 2, limit: 2 });
				expect(page2.meta.current_page).toBe(2);
			}
		});
	});

	describe("getContact", () => {
		it("returns a full contact by ID", async () => {
			const list = await client.listContacts({ page: 1, limit: 1 });
			if (list.data.length === 0) return;

			const contactId = list.data[0].id;
			const contact = await client.getContact(contactId);

			expect(contact.id).toBe(contactId);
			expect(contact.first_name).toBeTypeOf("string");
			expect(contact.complete_name).toBeTypeOf("string");
		});
	});

	describe("getAllContacts", () => {
		it("returns all contacts via pagination", async () => {
			const allContacts = await client.getAllContacts();

			expect(Array.isArray(allContacts)).toBe(true);
			expect(allContacts.length).toBeGreaterThanOrEqual(0);

			// Cross-check: total from paginated endpoint should match
			const firstPage = await client.listContacts({ page: 1, limit: 100 });
			expect(allContacts.length).toBe(firstPage.meta.total);
		});
	});

	describe("listContactNotes", () => {
		it("returns notes for a contact", async () => {
			const list = await client.listContacts({ page: 1, limit: 1 });
			if (list.data.length === 0) return;

			const contactId = list.data[0].id;
			const notes = await client.listContactNotes(contactId);

			expect(notes.data).toBeDefined();
			expect(Array.isArray(notes.data)).toBe(true);
			expect(notes.meta).toBeDefined();
		});
	});

	describe("getUpcomingReminders", () => {
		it("returns upcoming reminders for the current month", async () => {
			const reminders = await client.getUpcomingReminders(0);

			expect(Array.isArray(reminders)).toBe(true);
		});
	});

	describe("listGenders", () => {
		it("returns available genders", async () => {
			const genders = await client.listGenders();

			expect(Array.isArray(genders)).toBe(true);
			expect(genders.length).toBeGreaterThan(0);
		});
	});

	describe("listContactFieldTypes", () => {
		it("returns available contact field types", async () => {
			const fieldTypes = await client.listContactFieldTypes();

			expect(Array.isArray(fieldTypes)).toBe(true);
			expect(fieldTypes.length).toBeGreaterThan(0);
		});
	});

	describe("listContactAddresses", () => {
		it("returns addresses for a contact", async () => {
			const list = await client.listContacts({ page: 1, limit: 1 });
			if (list.data.length === 0) return;

			const contactId = list.data[0].id;
			const addresses = await client.listContactAddresses(contactId);

			expect(Array.isArray(addresses)).toBe(true);
		});
	});

	describe("getContactWithFields", () => {
		it("returns contact with contact fields embedded", async () => {
			const list = await client.listContacts({ page: 1, limit: 1 });
			if (list.data.length === 0) return;

			const contactId = list.data[0].id;
			const contact = await client.getContactWithFields(contactId);

			expect(contact.id).toBe(contactId);
			expect(contact.first_name).toBeTypeOf("string");
		});
	});
});
