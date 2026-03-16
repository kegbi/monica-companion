import { signServiceToken } from "@monica-companion/auth";
import { MonicaApiError, MonicaUrlValidationError } from "@monica-companion/monica-api-lib";
import {
	activityFixture,
	addressFixture,
	contactFieldFixture,
	contactFieldTypeFixture,
	fullContactFixture,
	genderFixture,
	noteFixture,
	reminderOutboxFixture,
} from "@monica-companion/monica-api-lib/__fixtures__";
import type { Context } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";

// Mock observability to avoid symlink resolution issues in test environment
vi.mock("@monica-companion/observability", () => ({
	otelMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
	createLogger: () => ({
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
	}),
}));

// Mock the shared module: keep createMonicaClient as a mock fn,
// but provide the real handleMonicaError logic inline to avoid
// import-order issues with the observability package.
vi.mock("../routes/shared.js", () => {
	function handleMonicaError(c: Context, err: unknown) {
		if (err instanceof MonicaUrlValidationError) {
			return c.json({ error: "Invalid Monica instance URL" }, 422);
		}
		if (err instanceof MonicaApiError) {
			const status = err.statusCode >= 500 ? 502 : err.statusCode;
			return c.json({ error: "Monica API error" }, status as 400);
		}
		if (err instanceof Error && err.name === "CredentialResolutionError") {
			return c.json({ error: "Failed to resolve user credentials" }, 502);
		}
		throw err;
	}

	return {
		createMonicaClient: vi.fn(),
		handleMonicaError,
	};
});

import { createApp } from "../app.js";
import { createMonicaClient } from "../routes/shared.js";

const TEST_SECRET = "test-secret-for-signing-tokens";

const testConfig: Config = {
	port: 3004,
	userManagementUrl: "http://user-management:3007",
	monicaDefaultTimeoutMs: 5000,
	monicaRetryMax: 0,
	allowPrivateNetworkTargets: false,
	auth: {
		serviceName: "monica-integration",
		jwtSecrets: [TEST_SECRET],
	},
};

async function createToken(issuer: string, subject?: string): Promise<string> {
	return signServiceToken({
		issuer: issuer as "ai-router",
		audience: "monica-integration",
		secret: TEST_SECRET,
		subject,
		correlationId: "test-correlation-id",
	});
}

function setupMockClient(overrides: Record<string, unknown> = {}) {
	const mockClient = {
		getAllContacts: vi.fn().mockResolvedValue([fullContactFixture]),
		getContact: vi.fn().mockResolvedValue(fullContactFixture),
		listContactNotes: vi.fn().mockResolvedValue({
			data: [noteFixture],
			links: { first: "", last: "", prev: null, next: null },
			meta: {
				current_page: 1,
				from: 1,
				last_page: 1,
				links: [],
				path: "",
				per_page: 15,
				to: 1,
				total: 1,
			},
		}),
		getUpcomingReminders: vi.fn().mockResolvedValue([reminderOutboxFixture]),
		listGenders: vi.fn().mockResolvedValue([genderFixture]),
		listContactFieldTypes: vi.fn().mockResolvedValue([contactFieldTypeFixture]),
		createContact: vi.fn().mockResolvedValue(fullContactFixture),
		updateContact: vi.fn().mockResolvedValue(fullContactFixture),
		createNote: vi.fn().mockResolvedValue(noteFixture),
		createActivity: vi.fn().mockResolvedValue(activityFixture),
		createContactField: vi.fn().mockResolvedValue(contactFieldFixture),
		createAddress: vi.fn().mockResolvedValue(addressFixture),
		...overrides,
	};

	(createMonicaClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

	return mockClient;
}

describe("monica-integration app", () => {
	let app: ReturnType<typeof createApp>;

	beforeEach(() => {
		vi.clearAllMocks();
		app = createApp(testConfig);
		setupMockClient();
	});

	describe("GET /health", () => {
		it("returns 200 without auth", async () => {
			const res = await app.request("/health");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.status).toBe("ok");
			expect(body.service).toBe("monica-integration");
		});
	});

	describe("auth enforcement", () => {
		it("returns 401 without Authorization header", async () => {
			const res = await app.request("/internal/contacts/resolution-summaries");
			expect(res.status).toBe(401);
		});

		it("returns 403 when called by disallowed service", async () => {
			// scheduler is not allowed to call resolution-summaries (ai-router only)
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/contacts/resolution-summaries", {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(res.status).toBe(403);
		});
	});

	describe("requireUserId guard", () => {
		it("returns 400 when userId is missing from JWT", async () => {
			// Token without subject
			const token = await createToken("ai-router");
			const res = await app.request("/internal/contacts/resolution-summaries", {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error).toContain("userId");
		});
	});

	describe("GET /internal/contacts/resolution-summaries", () => {
		it("returns 200 with contact resolution summaries", async () => {
			const token = await createToken("ai-router", "user-123");
			const res = await app.request("/internal/contacts/resolution-summaries", {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data).toHaveLength(1);
			expect(body.data[0].contactId).toBe(42);
			expect(body.data[0].displayName).toBe("John Doe (Johnny)");
		});

		it("returns 403 when called by scheduler", async () => {
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/contacts/resolution-summaries", {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(res.status).toBe(403);
		});
	});

	describe("GET /internal/contacts/:contactId", () => {
		it("returns 200 with contact details (ai-router caller)", async () => {
			const token = await createToken("ai-router", "user-123");
			const res = await app.request("/internal/contacts/42", {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.contactId).toBe(42);
		});

		it("returns 200 with contact details (scheduler caller)", async () => {
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/contacts/42", {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
		});
	});

	describe("GET /internal/contacts/:contactId/notes", () => {
		it("returns 200 with notes (ai-router caller)", async () => {
			const token = await createToken("ai-router", "user-123");
			const res = await app.request("/internal/contacts/42/notes", {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data).toHaveLength(1);
		});
	});

	describe("GET /internal/reminders/upcoming", () => {
		it("returns 200 with upcoming reminders", async () => {
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/reminders/upcoming?monthOffset=0", {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data).toHaveLength(1);
		});
	});

	describe("GET /internal/genders", () => {
		it("returns 200 with genders (scheduler caller)", async () => {
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/genders", {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data).toHaveLength(1);
			expect(body.data[0].name).toBe("Man");
		});

		it("returns 403 when called by ai-router", async () => {
			const token = await createToken("ai-router", "user-123");
			const res = await app.request("/internal/genders", {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(403);
		});
	});

	describe("GET /internal/contact-field-types", () => {
		it("returns 200 with contact field types (scheduler caller)", async () => {
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/contact-field-types", {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data).toHaveLength(1);
		});
	});

	describe("POST /internal/contacts", () => {
		it("returns 201 with created contact info", async () => {
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/contacts", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					firstName: "Alice",
					genderId: 1,
				}),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.contactId).toBe(42);
			expect(body.displayName).toBe("John Doe (Johnny)");
		});

		it("returns 400 on invalid request body", async () => {
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/contacts", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(400);
		});

		it("returns 403 when called by ai-router", async () => {
			const token = await createToken("ai-router", "user-123");
			const res = await app.request("/internal/contacts", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ firstName: "Alice", genderId: 1 }),
			});

			expect(res.status).toBe(403);
		});
	});

	describe("PUT /internal/contacts/:contactId", () => {
		it("returns 200 with updated contact info", async () => {
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/contacts/42", {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					firstName: "Alice",
					genderId: 1,
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.contactId).toBe(42);
		});
	});

	describe("POST /internal/contacts/:contactId/notes", () => {
		it("returns 201 with noteId", async () => {
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/contacts/42/notes", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ body: "Test note content" }),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.noteId).toBe(101);
		});
	});

	describe("POST /internal/activities", () => {
		it("returns 201 with activityId", async () => {
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/activities", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					summary: "Lunch",
					happenedAt: "2026-03-10",
					contactIds: [42],
				}),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.activityId).toBe(201);
		});
	});

	describe("POST /internal/contacts/:contactId/contact-fields", () => {
		it("returns 201 with contactFieldId", async () => {
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/contacts/42/contact-fields", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					value: "john@example.test",
					type: "email",
					// contactFieldTypeId is a known boundary leak (V1 pragmatism)
					contactFieldTypeId: 1,
				}),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.contactFieldId).toBe(401);
		});
	});

	describe("POST /internal/contacts/:contactId/addresses", () => {
		it("returns 201 with addressId", async () => {
			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/contacts/42/addresses", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					country: "US",
					city: "Testville",
				}),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.addressId).toBe(10);
		});
	});

	describe("URL validation error handling", () => {
		it("returns 422 when createMonicaClient throws MonicaUrlValidationError", async () => {
			(createMonicaClient as ReturnType<typeof vi.fn>).mockRejectedValue(
				new MonicaUrlValidationError("BLOCKED_IP", "URL resolves to a blocked IP address"),
			);

			const token = await createToken("ai-router", "user-123");
			const res = await app.request("/internal/contacts/resolution-summaries", {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(422);
			const body = await res.json();
			expect(body.error).toBe("Invalid Monica instance URL");
		});

		it("does not leak URL or IP details in 422 response", async () => {
			(createMonicaClient as ReturnType<typeof vi.fn>).mockRejectedValue(
				new MonicaUrlValidationError("BLOCKED_IP", "URL resolves to 127.0.0.1"),
			);

			const token = await createToken("ai-router", "user-123");
			const res = await app.request("/internal/contacts/resolution-summaries", {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(422);
			const body = await res.json();
			const bodyStr = JSON.stringify(body);
			expect(bodyStr).not.toContain("127.0.0.1");
			expect(bodyStr).not.toContain("resolves to");
		});

		it("returns 422 for HTTP_NOT_ALLOWED on write endpoints too", async () => {
			(createMonicaClient as ReturnType<typeof vi.fn>).mockRejectedValue(
				new MonicaUrlValidationError("HTTP_NOT_ALLOWED", "Only HTTPS allowed"),
			);

			const token = await createToken("scheduler", "user-123");
			const res = await app.request("/internal/contacts", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ firstName: "Alice", genderId: 1 }),
			});

			expect(res.status).toBe(422);
			const body = await res.json();
			expect(body.error).toBe("Invalid Monica instance URL");
		});
	});
});
