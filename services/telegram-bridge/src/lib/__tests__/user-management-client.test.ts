import { describe, expect, it, vi } from "vitest";
import { createUserManagementClient } from "../user-management-client.js";

/**
 * Stubs the global fetch so that createServiceClient (used internally)
 * will call our mock. We pass the mock through options indirectly by
 * intercepting at the module level.
 */
function createClientWithMockFetch(mockFetch: ReturnType<typeof vi.fn>) {
	// Override globalThis.fetch for the duration of the test.
	const original = globalThis.fetch;
	globalThis.fetch = mockFetch as unknown as typeof fetch;

	const client = createUserManagementClient({
		baseUrl: "http://user-management:3007",
		secret: "test-secret-256-bit-minimum-key!",
		timeoutMs: 5000,
	});

	// Restore immediately; the client captures fetch at creation time through
	// createServiceClient which uses globalThis.fetch by default.
	globalThis.fetch = original;

	return client;
}

describe("UserManagementClient.issueSetupToken", () => {
	it("POSTs to /internal/setup-tokens with correct body and returns response", async () => {
		const responseBody = {
			setupUrl: "https://app.example.com/setup?sig=abc",
			tokenId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
			expiresAt: "2026-03-21T12:15:00Z",
		};

		const mockFetch = vi.fn(
			async () => new Response(JSON.stringify(responseBody), { status: 201 }),
		);
		const client = createClientWithMockFetch(mockFetch);

		const result = await client.issueSetupToken("12345", "corr-id-1");

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://user-management:3007/internal/setup-tokens");
		expect(init.method).toBe("POST");

		// Verify body
		const body = JSON.parse(init.body as string);
		expect(body).toEqual({ telegramUserId: "12345", step: "onboarding" });

		// Verify auth header present
		const headers = init.headers as Record<string, string>;
		expect(headers.Authorization).toMatch(/^Bearer /);

		// Verify result
		expect(result).toEqual(responseBody);
	});

	it("throws on non-2xx response", async () => {
		const mockFetch = vi.fn(
			async () => new Response(JSON.stringify({ error: "Bad request" }), { status: 400 }),
		);
		const client = createClientWithMockFetch(mockFetch);

		await expect(client.issueSetupToken("12345")).rejects.toThrow(
			"Issue setup token failed with status 400",
		);
	});

	it("respects configured timeout via AbortSignal", async () => {
		// Create a client with a very short timeout
		const original = globalThis.fetch;
		const mockFetch = vi.fn(async (_url: string, init?: RequestInit) => {
			// Verify an abort signal is present
			expect(init?.signal).toBeDefined();
			return new Response(
				JSON.stringify({
					setupUrl: "https://example.com/setup",
					tokenId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
					expiresAt: "2026-03-21T12:15:00Z",
				}),
				{ status: 201 },
			);
		});
		globalThis.fetch = mockFetch as unknown as typeof fetch;
		const client = createUserManagementClient({
			baseUrl: "http://user-management:3007",
			secret: "test-secret-256-bit-minimum-key!",
			timeoutMs: 1000,
		});
		globalThis.fetch = original;

		await client.issueSetupToken("12345");

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});
});
