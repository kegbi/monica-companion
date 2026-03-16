/** Realistic embedded contact fixture with obviously fake data. */
export const embeddedContactFixture = {
	id: 42,
	uuid: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
	object: "contact" as const,
	hash_id: "h:abc123xyz",
	first_name: "John",
	last_name: "Doe",
	nickname: "Johnny",
	complete_name: "John Doe (Johnny)",
	initials: "JD",
	gender: "Man",
	gender_type: "M",
	is_starred: true,
	is_partial: false,
	is_active: true,
	is_dead: false,
	is_me: false,
	information: {
		birthdate: {
			is_age_based: false,
			is_year_unknown: false,
			date: "1990-01-15T00:00:00Z",
		},
		deceased_date: {
			is_age_based: null,
			is_year_unknown: null,
			date: null,
		},
		avatar: {
			url: "https://example.test/avatars/default.png",
			source: "default",
			default_avatar_color: "#b3d5fe",
		},
	},
	url: "https://app.example.test/api/contacts/42",
	account: { id: 1 },
};

/** A second embedded contact for use in relationships and activities. */
export const embeddedContact2Fixture = {
	id: 99,
	uuid: "f1e2d3c4-b5a6-4789-0123-456789abcdef",
	object: "contact" as const,
	hash_id: "h:def456uvw",
	first_name: "Jane",
	last_name: "Smith",
	nickname: null,
	complete_name: "Jane Smith",
	initials: "JS",
	gender: "Woman",
	gender_type: "F",
	is_starred: false,
	is_partial: false,
	is_active: true,
	is_dead: false,
	is_me: false,
	information: {
		birthdate: {
			is_age_based: null,
			is_year_unknown: null,
			date: null,
		},
		deceased_date: {
			is_age_based: null,
			is_year_unknown: null,
			date: null,
		},
		avatar: {
			url: "https://example.test/avatars/default.png",
			source: "default",
			default_avatar_color: "#fec5bb",
		},
	},
	url: "https://app.example.test/api/contacts/99",
	account: { id: 1 },
};
