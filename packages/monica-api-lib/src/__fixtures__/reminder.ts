import { embeddedContactFixture } from "./embedded-contact.js";

/** Realistic reminder fixture with obviously fake data. */
export const reminderFixture = {
	id: 301,
	uuid: "rem-uuid-0001",
	object: "reminder" as const,
	title: "Birthday reminder for John",
	description: "Remember to wish John a happy birthday!",
	frequency_type: "year" as const,
	frequency_number: 1,
	initial_date: "1990-01-15T00:00:00Z",
	delible: false,
	account: { id: 1 },
	contact: embeddedContactFixture,
	created_at: "2025-06-15T10:00:00Z",
	updated_at: "2025-06-15T10:00:00Z",
};

/** Realistic reminder outbox fixture (upcoming reminder entry). */
export const reminderOutboxFixture = {
	id: 5001,
	reminder_id: 301,
	object: "reminderoutbox",
	planned_date: "2026-01-15",
	title: "Birthday reminder for John",
	description: "Remember to wish John a happy birthday!",
	frequency_type: "year" as const,
	frequency_number: 1,
	initial_date: "1990-01-15T00:00:00Z",
	delible: false,
	account: { id: 1 },
	contact: embeddedContactFixture,
	created_at: "2025-06-15T10:00:00Z",
	updated_at: "2025-06-15T10:00:00Z",
};

/** Realistic create reminder request fixture. */
export const createReminderRequestFixture = {
	title: "Call John about the project",
	initial_date: "2026-04-01",
	frequency_type: "month" as const,
	frequency_number: 1,
	contact_id: 42,
};
