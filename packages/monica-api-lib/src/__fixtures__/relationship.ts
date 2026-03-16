import { embeddedContact2Fixture, embeddedContactFixture } from "./embedded-contact.js";

/** Relationship type fixture. */
export const relationshipTypeFixture = {
	id: 1,
	object: "relationshiptype" as const,
	name: "partner",
	name_reverse_relationship: "partner",
	relationship_type_group_id: 1,
	delible: false,
	account: { id: 1 },
	created_at: "2025-01-01T00:00:00Z",
	updated_at: "2025-01-01T00:00:00Z",
};

/** Relationship type group fixture. */
export const relationshipTypeGroupFixture = {
	id: 1,
	object: "relationshiptypegroup" as const,
	name: "love",
	delible: false,
	account: { id: 1 },
	created_at: "2025-01-01T00:00:00Z",
	updated_at: "2025-01-01T00:00:00Z",
};

/** RelationshipShort fixture (embedded in full contact). */
export const relationshipShortFixture = {
	relationship: {
		id: 1,
		uuid: "rel-uuid-0001",
		name: "partner",
	},
	contact: embeddedContact2Fixture,
};

/** Full relationship fixture. */
export const relationshipFixture = {
	id: 501,
	uuid: "rel-full-uuid-0001",
	object: "relationship" as const,
	contact_is: embeddedContactFixture,
	relationship_type: relationshipTypeFixture,
	of_contact: embeddedContact2Fixture,
	url: "https://app.example.test/api/relationships/501",
	account: { id: 1 },
	created_at: "2025-06-15T10:00:00Z",
	updated_at: "2025-06-15T10:00:00Z",
};

/** Create relationship request fixture. */
export const createRelationshipRequestFixture = {
	contact_is: 42,
	of_contact: 99,
	relationship_type_id: 1,
};

/** Update relationship request fixture. */
export const updateRelationshipRequestFixture = {
	relationship_type_id: 2,
};
