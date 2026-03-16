import { afterAll, describe, expect, it } from "vitest";
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

describe("MonicaApiClient write operations against real instance", () => {
	const client = createClient();

	// Track created resource IDs for reference (cleanup is handled by tearing down the instance)
	const createdContactIds: number[] = [];

	afterAll(() => {
		// Log created resources for debugging. Cleanup is handled by
		// destroying the entire Monica Docker instance after the test run.
		if (createdContactIds.length > 0) {
			console.log(`Smoke tests created ${createdContactIds.length} contacts`);
		}
	});

	describe("createContact", () => {
		it("creates a contact and returns a valid FullContact", async () => {
			// First, get a gender ID from the real instance
			const genders = await client.listGenders();
			expect(genders.length).toBeGreaterThan(0);
			const genderId = genders[0].id;

			const contact = await client.createContact({
				first_name: "SmokeTest",
				last_name: "Contact",
				gender_id: genderId,
				is_birthdate_known: false,
				is_deceased: false,
				is_deceased_date_known: false,
			});

			expect(contact.id).toBeTypeOf("number");
			expect(contact.first_name).toBe("SmokeTest");
			expect(contact.last_name).toBe("Contact");
			expect(contact.object).toBe("contact");
			createdContactIds.push(contact.id);
		});
	});

	describe("createNote", () => {
		it("creates a note on a contact and returns a valid Note", async () => {
			// Ensure we have a contact to attach the note to
			const list = await client.listContacts({ page: 1, limit: 1 });
			expect(list.data.length).toBeGreaterThan(0);
			const contactId = list.data[0].id;

			const note = await client.createNote({
				body: "Smoke test note - created by automated testing",
				contact_id: contactId,
			});

			expect(note.id).toBeTypeOf("number");
			expect(note.body).toBe("Smoke test note - created by automated testing");
			expect(note.object).toBe("note");
		});
	});

	describe("createActivity", () => {
		it("creates an activity and returns a valid Activity", async () => {
			const list = await client.listContacts({ page: 1, limit: 1 });
			expect(list.data.length).toBeGreaterThan(0);
			const contactId = list.data[0].id;

			const activity = await client.createActivity({
				summary: "Smoke test activity",
				happened_at: "2026-03-15",
				contacts: [contactId],
			});

			expect(activity.id).toBeTypeOf("number");
			expect(activity.summary).toBe("Smoke test activity");
			expect(activity.object).toBe("activity");
		});
	});

	describe("createContactField", () => {
		it("creates a contact field and returns a valid ContactField", async () => {
			const list = await client.listContacts({ page: 1, limit: 1 });
			expect(list.data.length).toBeGreaterThan(0);
			const contactId = list.data[0].id;

			// Get a valid contact field type ID (e.g., Email)
			const fieldTypes = await client.listContactFieldTypes();
			expect(fieldTypes.length).toBeGreaterThan(0);
			const fieldTypeId = fieldTypes[0].id;

			const field = await client.createContactField({
				data: "smoketest@example.test",
				contact_field_type_id: fieldTypeId,
				contact_id: contactId,
			});

			expect(field.id).toBeTypeOf("number");
			expect(field.object).toBe("contactfield");
		});
	});

	describe("createAddress", () => {
		it("creates an address and returns a valid Address", async () => {
			const list = await client.listContacts({ page: 1, limit: 1 });
			expect(list.data.length).toBeGreaterThan(0);
			const contactId = list.data[0].id;

			const address = await client.createAddress({
				contact_id: contactId,
				name: "Smoke Test Address",
				city: "TestCity",
				country: "US",
			});

			expect(address.id).toBeTypeOf("number");
			expect(address.object).toBe("address");
			expect(address.city).toBe("TestCity");
		});
	});

	describe("createReminder", () => {
		it("creates a reminder and returns a valid Reminder", async () => {
			const list = await client.listContacts({ page: 1, limit: 1 });
			expect(list.data.length).toBeGreaterThan(0);
			const contactId = list.data[0].id;

			const reminder = await client.createReminder({
				title: "Smoke test reminder",
				initial_date: "2026-06-15",
				frequency_type: "year",
				frequency_number: 1,
				contact_id: contactId,
			});

			expect(reminder.id).toBeTypeOf("number");
			expect(reminder.object).toBe("reminder");
			expect(reminder.title).toBe("Smoke test reminder");
		});
	});

	describe("updateContact", () => {
		it("updates a contact and returns the updated FullContact", async () => {
			const genders = await client.listGenders();
			const genderId = genders[0].id;

			// Create a contact to update
			const created = await client.createContact({
				first_name: "SmokeUpdate",
				last_name: "Before",
				gender_id: genderId,
				is_birthdate_known: false,
				is_deceased: false,
				is_deceased_date_known: false,
			});
			createdContactIds.push(created.id);

			const updated = await client.updateContact(created.id, {
				first_name: "SmokeUpdate",
				last_name: "After",
				gender_id: genderId,
				is_birthdate_known: false,
				is_deceased: false,
				is_deceased_date_known: false,
			});

			expect(updated.id).toBe(created.id);
			expect(updated.last_name).toBe("After");
		});
	});

	describe("updateContactCareer", () => {
		it("updates contact career info", async () => {
			const list = await client.listContacts({ page: 1, limit: 1 });
			expect(list.data.length).toBeGreaterThan(0);
			const contactId = list.data[0].id;

			const updated = await client.updateContactCareer(contactId, {
				job: "Smoke Test Engineer",
				company: "Test Corp",
			});

			expect(updated.id).toBe(contactId);
			expect(updated.information.career.job).toBe("Smoke Test Engineer");
			expect(updated.information.career.company).toBe("Test Corp");
		});
	});
});
