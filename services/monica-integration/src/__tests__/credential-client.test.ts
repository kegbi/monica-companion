import type { ServiceClient } from "@monica-companion/auth";
import { describe, expect, it, vi } from "vitest";
import { CredentialResolutionError, fetchMonicaCredentials } from "../lib/credential-client.js";

function createMockServiceClient(response: Response): ServiceClient {
	return {
		fetch: vi.fn().mockResolvedValue(response),
	};
}

describe("fetchMonicaCredentials", () => {
	it("calls the correct endpoint with userId", async () => {
		const serviceClient = createMockServiceClient(
			new Response(
				JSON.stringify({
					baseUrl: "https://monica.example.test",
					apiToken: "test-token-abc",
				}),
				{ status: 200 },
			),
		);

		await fetchMonicaCredentials(serviceClient, "user-123", "corr-456");

		expect(serviceClient.fetch).toHaveBeenCalledWith(
			"/internal/users/user-123/monica-credentials",
			expect.objectContaining({
				userId: "user-123",
				correlationId: "corr-456",
			}),
		);
	});

	it("returns baseUrl and apiToken on success", async () => {
		const serviceClient = createMockServiceClient(
			new Response(
				JSON.stringify({
					baseUrl: "https://monica.example.test",
					apiToken: "test-token-abc",
				}),
				{ status: 200 },
			),
		);

		const result = await fetchMonicaCredentials(serviceClient, "user-123", "corr-456");

		expect(result.baseUrl).toBe("https://monica.example.test");
		expect(result.apiToken).toBe("test-token-abc");
	});

	it("throws CredentialResolutionError on non-200 response", async () => {
		const serviceClient = createMockServiceClient(
			new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
		);

		await expect(fetchMonicaCredentials(serviceClient, "user-999", "corr-456")).rejects.toThrow(
			CredentialResolutionError,
		);
	});

	it("throws CredentialResolutionError on invalid response shape", async () => {
		const serviceClient = createMockServiceClient(
			new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
		);

		await expect(fetchMonicaCredentials(serviceClient, "user-123", "corr-456")).rejects.toThrow(
			CredentialResolutionError,
		);
	});

	it("throws CredentialResolutionError on network error", async () => {
		const serviceClient: ServiceClient = {
			fetch: vi.fn().mockRejectedValue(new Error("Connection refused")),
		};

		await expect(fetchMonicaCredentials(serviceClient, "user-123", "corr-456")).rejects.toThrow(
			CredentialResolutionError,
		);
	});
});
