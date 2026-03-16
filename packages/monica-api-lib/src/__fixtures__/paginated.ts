import { fullContactFixture } from "./full-contact.js";

/** Paginated contacts response fixture. */
export const paginatedContactsFixture = {
	data: [fullContactFixture],
	links: {
		first: "https://app.example.test/api/contacts?page=1",
		last: "https://app.example.test/api/contacts?page=1",
		prev: null,
		next: null,
	},
	meta: {
		current_page: 1,
		from: 1,
		last_page: 1,
		links: [
			{ url: null, label: "&laquo; Previous", active: false },
			{
				url: "https://app.example.test/api/contacts?page=1",
				label: "1",
				active: true,
			},
			{ url: null, label: "Next &raquo;", active: false },
		],
		path: "https://app.example.test/api/contacts",
		per_page: 15,
		to: 1,
		total: 1,
	},
};
