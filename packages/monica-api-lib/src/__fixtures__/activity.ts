import { embeddedContactFixture } from "./embedded-contact.js";

/** Activity type category fixture. */
export const activityTypeCategoryFixture = {
	id: 1,
	uuid: "atc-uuid-0001",
	object: "activityTypeCategory" as const,
	name: "Simple activities",
	account: { id: 1 },
	created_at: "2025-01-01T00:00:00Z",
	updated_at: "2025-01-01T00:00:00Z",
};

/** Activity type fixture. */
export const activityTypeFixture = {
	id: 1,
	uuid: "at-uuid-0001",
	object: "activityType" as const,
	name: "Just hung out",
	location_type: null,
	activity_type_category: activityTypeCategoryFixture,
	account: { id: 1 },
	created_at: "2025-01-01T00:00:00Z",
	updated_at: "2025-01-01T00:00:00Z",
};

/** Realistic activity fixture with obviously fake data. */
export const activityFixture = {
	id: 201,
	uuid: "act-uuid-0001",
	object: "activity" as const,
	summary: "Lunch at the park",
	description: "Had a picnic lunch together at Riverside Park.",
	happened_at: "2026-03-10",
	activity_type: activityTypeFixture,
	attendees: {
		total: 1,
		contacts: [embeddedContactFixture],
	},
	emotions: [],
	url: "https://app.example.test/api/activities/201",
	account: { id: 1 },
	created_at: "2026-03-10T15:00:00Z",
	updated_at: "2026-03-10T15:00:00Z",
};

/** Realistic create activity request fixture. */
export const createActivityRequestFixture = {
	activity_type_id: 1,
	summary: "Lunch at the park",
	description: "Had a picnic lunch together at Riverside Park.",
	happened_at: "2026-03-10",
	contacts: [42],
};
