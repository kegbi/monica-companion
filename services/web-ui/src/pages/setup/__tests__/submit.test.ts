import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the user-management client before importing submit handler
const mockFetch = vi.fn();
vi.mock("../../../lib/user-management-client", () => ({
	getUserManagementClient: () => ({
		fetch: mockFetch,
	}),
}));

// Dynamic import after mock setup
const { POST } = await import("../submit");

function makeFormRequest(fields: Record<string, string>): Request {
	const params = new URLSearchParams(fields);
	return new Request("http://localhost/setup/submit", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: params.toString(),
	});
}

beforeEach(() => {
	mockFetch.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("POST /setup/submit", () => {
	it("returns 400 when required fields are missing", async () => {
		const request = makeFormRequest({ tokenId: "abc" });
		const response = await POST({ request } as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
	});

	it("returns 400 when monicaBaseUrl is missing", async () => {
		const request = makeFormRequest({
			tokenId: "abc",
			sig: "test-sig",
			monicaApiKey: "key",
			timezone: "America/New_York",
		});
		const response = await POST({ request } as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
	});

	it("returns 400 when monicaApiKey is empty", async () => {
		const request = makeFormRequest({
			tokenId: "abc",
			sig: "test-sig",
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "",
			timezone: "America/New_York",
		});
		const response = await POST({ request } as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
	});

	it("forwards onboarding fields to user-management and redirects to success", async () => {
		mockFetch.mockResolvedValue(
			new Response(JSON.stringify({ consumed: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const request = makeFormRequest({
			tokenId: "token-123",
			sig: "valid-sig",
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "my-api-key",
			language: "en",
			confirmationMode: "explicit",
			timezone: "America/New_York",
			reminderCadence: "daily",
			reminderTime: "08:00",
		});
		const response = await POST({ request } as Parameters<typeof POST>[0]);

		// Should redirect to success page
		expect(response.status).toBe(303);
		expect(response.headers.get("Location")).toBe("/setup/success");

		// Verify the forwarded payload includes onboarding fields
		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, options] = mockFetch.mock.calls[0];
		expect(url).toContain("/internal/setup-tokens/token-123/consume");
		const forwarded = JSON.parse(options.body);
		expect(forwarded.sig).toBe("valid-sig");
		expect(forwarded.monicaBaseUrl).toBe("https://app.monicahq.com");
		expect(forwarded.monicaApiKey).toBe("my-api-key");
		expect(forwarded.timezone).toBe("America/New_York");
	});

	it("redirects to error page when token consumption fails", async () => {
		mockFetch.mockResolvedValue(
			new Response(JSON.stringify({ consumed: false, reason: "expired" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const request = makeFormRequest({
			tokenId: "token-456",
			sig: "valid-sig",
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "key",
			timezone: "America/New_York",
		});
		const response = await POST({ request } as Parameters<typeof POST>[0]);

		expect(response.status).toBe(303);
		expect(response.headers.get("Location")).toBe("/setup/error?reason=expired");
	});

	it("redirects to error page when user-management returns HTTP error", async () => {
		mockFetch.mockResolvedValue(
			new Response(JSON.stringify({ error: "Server error" }), {
				status: 500,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const request = makeFormRequest({
			tokenId: "token-789",
			sig: "valid-sig",
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "key",
			timezone: "America/New_York",
		});
		const response = await POST({ request } as Parameters<typeof POST>[0]);

		expect(response.status).toBe(303);
		expect(response.headers.get("Location")).toBe("/setup/error?reason=server_error");
	});

	it("redirects to error page on network failure", async () => {
		mockFetch.mockRejectedValue(new Error("Network error"));

		const request = makeFormRequest({
			tokenId: "token-net",
			sig: "valid-sig",
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "key",
			timezone: "America/New_York",
		});
		const response = await POST({ request } as Parameters<typeof POST>[0]);

		expect(response.status).toBe(303);
		expect(response.headers.get("Location")).toBe("/setup/error?reason=server_error");
	});

	it("applies default values for optional fields", async () => {
		mockFetch.mockResolvedValue(
			new Response(JSON.stringify({ consumed: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		const request = makeFormRequest({
			tokenId: "token-defaults",
			sig: "valid-sig",
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "key",
			timezone: "Europe/London",
		});
		const response = await POST({ request } as Parameters<typeof POST>[0]);

		expect(response.status).toBe(303);
		const [, options] = mockFetch.mock.calls[0];
		const forwarded = JSON.parse(options.body);
		expect(forwarded.language).toBe("en");
		expect(forwarded.confirmationMode).toBe("explicit");
		expect(forwarded.reminderCadence).toBe("daily");
		expect(forwarded.reminderTime).toBe("08:00");
	});
});
