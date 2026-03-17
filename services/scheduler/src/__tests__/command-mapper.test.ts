import { describe, expect, it } from "vitest";
import { mapCommandToMonicaRequest } from "../lib/command-mapper";

describe("mapCommandToMonicaRequest", () => {
	it("maps create_contact to POST /internal/contacts", () => {
		const result = mapCommandToMonicaRequest({
			type: "create_contact",
			firstName: "Jane",
			lastName: "Doe",
			genderId: 1,
		});
		expect(result.method).toBe("POST");
		expect(result.path).toBe("/internal/contacts");
		expect(result.body).toEqual({
			firstName: "Jane",
			lastName: "Doe",
			genderId: 1,
		});
	});

	it("maps create_note to POST /internal/contacts/:contactId/notes", () => {
		const result = mapCommandToMonicaRequest({
			type: "create_note",
			contactId: 42,
			body: "Test note content",
		});
		expect(result.method).toBe("POST");
		expect(result.path).toBe("/internal/contacts/42/notes");
		expect(result.body).toEqual({ body: "Test note content" });
	});

	it("maps create_activity to POST /internal/activities", () => {
		const result = mapCommandToMonicaRequest({
			type: "create_activity",
			summary: "Lunch",
			happenedAt: "2026-01-15",
			contactIds: [1, 2],
		});
		expect(result.method).toBe("POST");
		expect(result.path).toBe("/internal/activities");
		expect(result.body).toEqual({
			summary: "Lunch",
			happenedAt: "2026-01-15",
			contactIds: [1, 2],
		});
	});

	it("maps update_contact_birthday to PUT /internal/contacts/:contactId", () => {
		const result = mapCommandToMonicaRequest({
			type: "update_contact_birthday",
			contactId: 10,
			day: 25,
			month: 12,
			year: 1990,
		});
		expect(result.method).toBe("PUT");
		expect(result.path).toBe("/internal/contacts/10");
		expect(result.body.birthdate).toEqual({ day: 25, month: 12, year: 1990 });
	});

	it("maps update_contact_phone to POST /internal/contacts/:contactId/contact-fields", () => {
		const result = mapCommandToMonicaRequest({
			type: "update_contact_phone",
			contactId: 5,
			value: "+1234567890",
			contactFieldTypeId: 2,
		});
		expect(result.method).toBe("POST");
		expect(result.path).toBe("/internal/contacts/5/contact-fields");
		expect(result.body).toEqual({
			value: "+1234567890",
			type: "phone",
			contactFieldTypeId: 2,
		});
	});

	it("maps update_contact_email to POST /internal/contacts/:contactId/contact-fields", () => {
		const result = mapCommandToMonicaRequest({
			type: "update_contact_email",
			contactId: 5,
			value: "jane@example.com",
			contactFieldTypeId: 1,
		});
		expect(result.method).toBe("POST");
		expect(result.path).toBe("/internal/contacts/5/contact-fields");
		expect(result.body).toEqual({
			value: "jane@example.com",
			type: "email",
			contactFieldTypeId: 1,
		});
	});

	it("maps update_contact_address to POST /internal/contacts/:contactId/addresses", () => {
		const result = mapCommandToMonicaRequest({
			type: "update_contact_address",
			contactId: 7,
			street: "123 Main St",
			city: "Springfield",
			country: "US",
		});
		expect(result.method).toBe("POST");
		expect(result.path).toBe("/internal/contacts/7/addresses");
		expect(result.body).toEqual({
			street: "123 Main St",
			city: "Springfield",
			country: "US",
		});
	});
});
