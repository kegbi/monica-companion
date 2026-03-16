import { embeddedContactFixture } from "./embedded-contact.js";

/** Realistic note fixture with obviously fake data. */
export const noteFixture = {
	id: 101,
	uuid: "note-uuid-0001",
	object: "note" as const,
	body: "Had a great conversation about upcoming travel plans.",
	is_favorited: false,
	favorited_at: null,
	url: "https://app.example.test/api/notes/101",
	account: { id: 1 },
	contact: embeddedContactFixture,
	created_at: "2026-03-10T14:00:00Z",
	updated_at: "2026-03-10T14:00:00Z",
};

/** Realistic create note request fixture. */
export const createNoteRequestFixture = {
	body: "Had a great conversation about upcoming travel plans.",
	contact_id: 42,
	is_favorited: false,
};
