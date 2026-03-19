import { describe, expect, it, vi } from "vitest";
import {
	activityFixture,
	addressFixture,
	contactFieldFixture,
	contactFieldTypeFixture,
	createContactRequestFixture,
	fullContactFixture,
	genderFixture,
	noteFixture,
	paginatedContactsFixture,
	reminderOutboxFixture,
} from "../__fixtures__/index.js";
import { MonicaApiClient } from "../client.js";
import { MonicaApiError, MonicaNetworkError } from "../errors.js";
import { MonicaUrlValidationError } from "../url-validation.js";

function mockFetchResponse(data: unknown, status = 200): typeof globalThis.fetch {
	return vi.fn<typeof globalThis.fetch>().mockResolvedValue(
		new Response(JSON.stringify(data), {
			status,
			headers: { "Content-Type": "application/json" },
		}),
	);
}

function paginatedEnvelope(data: unknown[], page = 1, lastPage = 1) {
	return {
		data,
		links: {
			first: "https://example.test/api/contacts?page=1",
			last: `https://example.test/api/contacts?page=${lastPage}`,
			prev: null,
			next: null,
		},
		meta: {
			current_page: page,
			from: 1,
			last_page: lastPage,
			links: [],
			path: "https://example.test/api/contacts",
			per_page: 100,
			to: data.length,
			total: data.length,
		},
	};
}

describe("MonicaApiClient - read operations", () => {
	const baseOpts = {
		baseUrl: "https://example.test",
		apiToken: "test-token-123",
		timeoutMs: 5000,
		retryOptions: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 50 },
	};

	describe("listContacts", () => {
		it("returns parsed FullContact[] from paginated response", async () => {
			const fetchFn = mockFetchResponse(paginatedContactsFixture);
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const result = await client.listContacts();

			expect(result.data).toHaveLength(1);
			expect(result.data[0].id).toBe(42);
			expect(result.data[0].complete_name).toBe("John Doe (Johnny)");
		});

		it("sets Authorization header", async () => {
			const fetchFn = mockFetchResponse(paginatedContactsFixture);
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			await client.listContacts();

			const callArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
			const headers = callArgs[1]?.headers;
			expect(headers).toBeDefined();
			expect(headers?.Authorization).toBe("Bearer test-token-123");
		});

		it("calls correct URL with query params", async () => {
			const fetchFn = mockFetchResponse(paginatedContactsFixture);
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			await client.listContacts({ page: 2, limit: 50, sort: "first_name", query: "John" });

			const callArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
			const url = callArgs[0] as string;
			expect(url).toContain("/api/contacts");
			expect(url).toContain("page=2");
			expect(url).toContain("limit=50");
			expect(url).toContain("sort=first_name");
			expect(url).toContain("query=John");
		});
	});

	describe("getContact", () => {
		it("returns typed contact data", async () => {
			const fetchFn = mockFetchResponse({ data: fullContactFixture });
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const result = await client.getContact(42);

			expect(result.id).toBe(42);
			expect(result.first_name).toBe("John");
		});

		it("throws MonicaApiError on 404", async () => {
			const fetchFn = mockFetchResponse({ error: { message: "Not found", error_code: 31 } }, 404);
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			await expect(client.getContact(999)).rejects.toThrow(MonicaApiError);
		});
	});

	describe("getAllContacts", () => {
		it("calls multiple pages when last_page > 1", async () => {
			const page1 = paginatedEnvelope([fullContactFixture], 1, 2);
			const page2 = paginatedEnvelope([{ ...fullContactFixture, id: 99 }], 2, 2);

			const fetchFn = vi
				.fn<typeof globalThis.fetch>()
				.mockResolvedValueOnce(
					new Response(JSON.stringify(page1), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
				)
				.mockResolvedValueOnce(
					new Response(JSON.stringify(page2), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
				);

			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });
			const results = await client.getAllContacts();

			expect(results).toHaveLength(2);
			expect(results[0].id).toBe(42);
			expect(results[1].id).toBe(99);
			expect(fetchFn).toHaveBeenCalledTimes(2);
		});
	});

	describe("listContactNotes", () => {
		it("returns parsed notes", async () => {
			const fetchFn = mockFetchResponse(paginatedEnvelope([noteFixture]));
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const result = await client.listContactNotes(42);

			expect(result.data).toHaveLength(1);
			expect(result.data[0].body).toBe("Had a great conversation about upcoming travel plans.");
		});
	});

	describe("getUpcomingReminders", () => {
		it("returns parsed reminder outbox entries", async () => {
			// Upcoming reminders returns a flat { data: [...] } response, not paginated
			const fetchFn = mockFetchResponse({ data: [reminderOutboxFixture] });
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const results = await client.getUpcomingReminders(0);

			expect(results).toHaveLength(1);
			expect(results[0].title).toBe("Birthday reminder for John");
		});
	});

	describe("listGenders", () => {
		it("returns parsed genders", async () => {
			const fetchFn = mockFetchResponse(paginatedEnvelope([genderFixture]));
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const results = await client.listGenders();

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Man");
		});
	});

	describe("listContactFieldTypes", () => {
		it("returns parsed contact field types", async () => {
			const fetchFn = mockFetchResponse(paginatedEnvelope([contactFieldTypeFixture]));
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const results = await client.listContactFieldTypes();

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("Email");
		});
	});

	describe("listContactAddresses", () => {
		it("returns parsed addresses", async () => {
			const fetchFn = mockFetchResponse(paginatedEnvelope([addressFixture]));
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const results = await client.listContactAddresses(42);

			expect(results).toHaveLength(1);
			expect(results[0].city).toBe("Testville");
		});
	});

	describe("getContactWithFields", () => {
		it("calls with ?with=contactfields", async () => {
			const contactWithFields = { ...fullContactFixture, contactFields: [] };
			const fetchFn = mockFetchResponse({ data: contactWithFields });
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			await client.getContactWithFields(42);

			const callArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
			const url = callArgs[0] as string;
			expect(url).toContain("with=contactfields");
		});
	});

	describe("base URL normalization", () => {
		it("strips trailing slash", async () => {
			const fetchFn = mockFetchResponse(paginatedContactsFixture);
			const client = new MonicaApiClient({
				...baseOpts,
				baseUrl: "https://example.test/",
				fetch: fetchFn,
			});

			await client.listContacts();

			const url = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
			expect(url).toMatch(/^https:\/\/example\.test\/api\/contacts/);
		});

		it("handles base URL with /api suffix", async () => {
			const fetchFn = mockFetchResponse(paginatedContactsFixture);
			const client = new MonicaApiClient({
				...baseOpts,
				baseUrl: "https://example.test/api",
				fetch: fetchFn,
			});

			await client.listContacts();

			const url = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
			expect(url).toMatch(/^https:\/\/example\.test\/api\/contacts/);
			expect(url).not.toContain("/api/api/");
		});
	});
});

describe("MonicaApiClient - write operations", () => {
	const baseOpts = {
		baseUrl: "https://example.test",
		apiToken: "test-token-123",
		timeoutMs: 5000,
		retryOptions: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 50 },
	};

	describe("createContact", () => {
		it("sends POST to /api/contacts with correct body", async () => {
			const fetchFn = mockFetchResponse({ data: fullContactFixture }, 201);
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const result = await client.createContact(createContactRequestFixture);

			expect(result.id).toBe(42);
			const callArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(callArgs[1]?.method).toBe("POST");
			const url = callArgs[0] as string;
			expect(url).toContain("/api/contacts");
		});

		it("throws Zod error on invalid request body before sending", async () => {
			const fetchFn = vi.fn<typeof globalThis.fetch>();
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			await expect(client.createContact({ first_name: "A" } as never)).rejects.toThrow();
			expect(fetchFn).not.toHaveBeenCalled();
		});
	});

	describe("createNote", () => {
		it("sends POST to /api/notes with correct body", async () => {
			const fetchFn = mockFetchResponse({ data: noteFixture }, 201);
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const result = await client.createNote({
				body: "Test note",
				contact_id: 42,
			});

			expect(result.id).toBe(101);
			const callArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(callArgs[1]?.method).toBe("POST");
		});
	});

	describe("createActivity", () => {
		it("sends POST to /api/activities", async () => {
			const fetchFn = mockFetchResponse({ data: activityFixture }, 201);
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const result = await client.createActivity({
				summary: "Lunch",
				happened_at: "2026-03-10",
				contacts: [42],
			});

			expect(result.id).toBe(201);
		});
	});

	describe("updateContact", () => {
		it("sends PUT to /api/contacts/:id", async () => {
			const fetchFn = mockFetchResponse({ data: fullContactFixture });
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			await client.updateContact(42, createContactRequestFixture);

			const callArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(callArgs[1]?.method).toBe("PUT");
			const url = callArgs[0] as string;
			expect(url).toContain("/api/contacts/42");
		});
	});

	describe("createContactField", () => {
		it("sends POST to /api/contactfields", async () => {
			const fetchFn = mockFetchResponse({ data: contactFieldFixture }, 201);
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const result = await client.createContactField({
				data: "john@example.test",
				contact_field_type_id: 1,
				contact_id: 42,
			});

			expect(result.id).toBe(401);
		});
	});

	describe("createAddress", () => {
		it("sends POST to /api/addresses", async () => {
			const fetchFn = mockFetchResponse({ data: addressFixture }, 201);
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const result = await client.createAddress({
				country: "US",
				contact_id: 42,
				city: "Testville",
			});

			expect(result.id).toBe(10);
		});
	});

	describe("createReminder", () => {
		it("sends POST to /api/reminders", async () => {
			const reminderResponse = {
				id: 301,
				uuid: "rem-uuid-0001",
				object: "reminder" as const,
				title: "Test",
				description: null,
				frequency_type: "year" as const,
				frequency_number: 1,
				initial_date: "2026-01-15T00:00:00Z",
				delible: true,
				account: { id: 1 },
				contact: {
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
						deceased_date: { is_age_based: null, is_year_unknown: null, date: null },
						avatar: {
							url: "https://example.test/avatars/default.png",
							source: "default",
							default_avatar_color: "#b3d5fe",
						},
					},
					url: "https://app.example.test/api/contacts/42",
					account: { id: 1 },
				},
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-01T00:00:00Z",
			};
			const fetchFn = mockFetchResponse({ data: reminderResponse }, 201);
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			const result = await client.createReminder({
				title: "Test",
				initial_date: "2026-01-15",
				frequency_type: "year",
				frequency_number: 1,
				contact_id: 42,
			});

			expect(result.id).toBe(301);
		});
	});

	describe("updateContactCareer", () => {
		it("sends PUT to /api/contacts/:id/work", async () => {
			const fetchFn = mockFetchResponse({ data: fullContactFixture });
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			await client.updateContactCareer(42, { job: "Engineer" });

			const callArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(callArgs[1]?.method).toBe("PUT");
			const url = callArgs[0] as string;
			expect(url).toContain("/api/contacts/42/work");
		});
	});

	describe("response validation", () => {
		it("throws on response that does not match schema", async () => {
			const fetchFn = mockFetchResponse({ data: { id: "not-a-number" } });
			const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

			await expect(client.getContact(42)).rejects.toThrow();
		});
	});
});

describe("MonicaApiClient - redirect protection", () => {
	const baseOpts = {
		baseUrl: "https://example.test",
		apiToken: "test-token-123",
		timeoutMs: 5000,
		retryOptions: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 50 },
	};

	it("throws MonicaNetworkError on redirect response", async () => {
		const fetchFn = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
			new Response(null, {
				status: 302,
				headers: { Location: "https://other.example.test/api/contacts" },
			}),
		);
		const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

		await expect(client.listContacts()).rejects.toThrow(MonicaNetworkError);
	});

	it("throws MonicaUrlValidationError when redirect targets blocked IP", async () => {
		const fetchFn = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
			new Response(null, {
				status: 301,
				headers: { Location: "http://127.0.0.1/api/contacts" },
			}),
		);
		const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

		await expect(client.listContacts()).rejects.toThrow(MonicaUrlValidationError);
	});

	it("sets redirect: manual on fetch calls", async () => {
		const fetchFn = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [],
					links: { first: "", last: "", prev: null, next: null },
					meta: {
						current_page: 1,
						from: null,
						last_page: 1,
						links: [],
						path: "",
						per_page: 100,
						to: null,
						total: 0,
					},
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			),
		);
		const client = new MonicaApiClient({ ...baseOpts, fetch: fetchFn });

		await client.listContacts();

		const callArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(callArgs[1]?.redirect).toBe("manual");
	});
});
