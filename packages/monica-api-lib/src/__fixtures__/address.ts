import { embeddedContactFixture } from "./embedded-contact.js";

/** Country fixture. */
export const countryFixture = {
	id: "US",
	object: "country" as const,
	name: "United States",
	iso: "US",
};

/** Realistic address fixture with obviously fake data. */
export const addressFixture = {
	id: 10,
	uuid: "addr-uuid-0001",
	object: "address" as const,
	name: "home",
	street: "123 Fake Street",
	city: "Testville",
	province: "TS",
	postal_code: "12345",
	latitude: 40.7128,
	longitude: -74.006,
	country: countryFixture,
	url: "https://app.example.test/api/addresses/10",
	account: { id: 1 },
	contact: embeddedContactFixture,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};
