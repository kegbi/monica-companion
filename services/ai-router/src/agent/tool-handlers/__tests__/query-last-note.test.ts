import type { ServiceClient } from "@monica-companion/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleQueryLastNote } from "../query-last-note.js";

function createMockServiceClient(): ServiceClient {
	return {
		fetch: vi.fn(),
	};
}

const userId = "550e8400-e29b-41d4-a716-446655440000";
const correlationId = "corr-test-last-note";

describe("handleQueryLastNote", () => {
	let serviceClient: ServiceClient;

	beforeEach(() => {
		vi.clearAllMocks();
		serviceClient = createMockServiceClient();
	});

	it("returns the most recent note when contact has notes", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{
						noteId: 101,
						body: "Had coffee with Jane today.",
						isFavorited: false,
						createdAt: "2026-03-10T10:00:00Z",
					},
				],
			}),
		});

		const result = await handleQueryLastNote({
			contactId: 1,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result).toEqual({
			status: "ok",
			note: {
				body: "Had coffee with Jane today.",
				createdAt: "2026-03-10T10:00:00Z",
			},
			contactId: 1,
		});
	});

	it("returns null note when contact has no notes", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({ data: [] }),
		});

		const result = await handleQueryLastNote({
			contactId: 2,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result).toEqual({
			status: "ok",
			note: null,
			contactId: 2,
		});
	});

	it("returns error when fetch throws", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("Service timeout"),
		);

		const result = await handleQueryLastNote({
			contactId: 1,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result.status).toBe("error");
	});

	it("returns error when response is not ok", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => "Server error",
		});

		const result = await handleQueryLastNote({
			contactId: 1,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result.status).toBe("error");
	});

	it("passes limit=1 query parameter in URL", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({ data: [] }),
		});

		await handleQueryLastNote({
			contactId: 42,
			serviceClient,
			userId,
			correlationId,
		});

		const [url] = (serviceClient.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe("/internal/contacts/42/notes?limit=1");
	});
});
