import type { ServiceClient } from "@monica-companion/auth";
import { describe, expect, it, vi } from "vitest";
import { ContactResolutionClientError, fetchContactSummaries } from "../client.js";

function createMockServiceClient(
	fetchImpl: (path: string, options?: unknown) => Promise<Response>,
): ServiceClient {
	return { fetch: vi.fn(fetchImpl) };
}

const validSummary = {
	contactId: 42,
	displayName: "John Doe (Johnny)",
	aliases: ["Johnny", "John", "Doe"],
	relationshipLabels: ["partner"],
	importantDates: [],
	lastInteractionAt: "2026-03-10T14:30:00Z",
};

describe("fetchContactSummaries", () => {
	it("returns parsed ContactResolutionSummary[] on valid response", async () => {
		const client = createMockServiceClient(
			async () =>
				new Response(JSON.stringify({ data: [validSummary] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		);

		const result = await fetchContactSummaries(client, "user-123", "corr-1");

		expect(result).toHaveLength(1);
		expect(result[0].contactId).toBe(42);
		expect(result[0].displayName).toBe("John Doe (Johnny)");
		expect(client.fetch).toHaveBeenCalledWith(
			"/internal/contacts/resolution-summaries",
			expect.objectContaining({
				userId: "user-123",
				correlationId: "corr-1",
			}),
		);
	});

	it("throws ContactResolutionClientError on HTTP error (502)", async () => {
		const client = createMockServiceClient(
			async () => new Response("Bad Gateway", { status: 502 }),
		);

		await expect(fetchContactSummaries(client, "user-123", "corr-1")).rejects.toThrow(
			ContactResolutionClientError,
		);

		await expect(fetchContactSummaries(client, "user-123", "corr-1")).rejects.toThrow(/502/);
	});

	it("throws ContactResolutionClientError on invalid response body", async () => {
		const client = createMockServiceClient(
			async () =>
				new Response(JSON.stringify({ data: [{ invalid: true }] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		);

		await expect(fetchContactSummaries(client, "user-123", "corr-1")).rejects.toThrow(
			ContactResolutionClientError,
		);
	});

	it("throws ContactResolutionClientError on network failure", async () => {
		const client = createMockServiceClient(async () => {
			throw new Error("ECONNREFUSED");
		});

		await expect(fetchContactSummaries(client, "user-123", "corr-1")).rejects.toThrow(
			ContactResolutionClientError,
		);
	});

	it("returns empty array when response data is empty", async () => {
		const client = createMockServiceClient(
			async () =>
				new Response(JSON.stringify({ data: [] }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		);

		const result = await fetchContactSummaries(client, "user-123", "corr-1");
		expect(result).toEqual([]);
	});

	it("passes signal with timeout to the fetch call", async () => {
		const client = createMockServiceClient(async (_path, options) => {
			const opts = options as { signal?: AbortSignal };
			expect(opts.signal).toBeDefined();
			return new Response(JSON.stringify({ data: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});

		await fetchContactSummaries(client, "user-123", "corr-1");
	});
});
