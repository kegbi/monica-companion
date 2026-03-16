import { embeddedContactFixture } from "./embedded-contact.js";

/** Contact field type fixture for email. */
export const contactFieldTypeFixture = {
	id: 1,
	uuid: "cft-uuid-0001",
	object: "contactfieldtype" as const,
	name: "Email",
	fontawesome_icon: "fa fa-envelope-open-o",
	protocol: "mailto:",
	delible: false,
	type: "email",
	account: { id: 1 },
	created_at: "2025-01-01T00:00:00Z",
	updated_at: "2025-01-01T00:00:00Z",
};

/** Realistic contact field fixture with obviously fake data. Note: response uses "content". */
export const contactFieldFixture = {
	id: 401,
	uuid: "cf-uuid-0001",
	object: "contactfield" as const,
	content: "john.doe@example.test",
	contact_field_type: contactFieldTypeFixture,
	labels: [],
	account: { id: 1 },
	contact: embeddedContactFixture,
	created_at: "2025-06-15T10:00:00Z",
	updated_at: "2025-06-15T10:00:00Z",
};

/** Realistic create contact field request fixture. Note: request uses "data". */
export const createContactFieldRequestFixture = {
	data: "john.doe@example.test",
	contact_field_type_id: 1,
	contact_id: 42,
};
