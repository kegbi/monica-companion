import type { ServiceClient } from "@monica-companion/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleQueryBirthday } from "../query-birthday.js";

function createMockServiceClient(): ServiceClient {
	return {
		fetch: vi.fn(),
	};
}

const userId = "550e8400-e29b-41d4-a716-446655440000";
const correlationId = "corr-test-birthday";

describe("handleQueryBirthday", () => {
	let serviceClient: ServiceClient;

	beforeEach(() => {
		vi.clearAllMocks();
		serviceClient = createMockServiceClient();
	});

	it("returns birthday when contact has a birthdate in importantDates", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				contactId: 1,
				displayName: "Jane Doe",
				aliases: [],
				relationshipLabels: [],
				importantDates: [{ label: "birthdate", date: "1990-05-15", isYearUnknown: false }],
				lastInteractionAt: null,
			}),
		});

		const result = await handleQueryBirthday({
			contactId: 1,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result).toEqual({
			status: "ok",
			birthday: "1990-05-15",
			isYearUnknown: false,
			contactId: 1,
		});
	});

	it("returns null birthday when contact has no birthdate", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				contactId: 2,
				displayName: "Bob Smith",
				aliases: [],
				relationshipLabels: [],
				importantDates: [],
				lastInteractionAt: null,
			}),
		});

		const result = await handleQueryBirthday({
			contactId: 2,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result).toEqual({
			status: "ok",
			birthday: null,
			isYearUnknown: false,
			contactId: 2,
		});
	});

	it("returns isYearUnknown true when birthdate has unknown year", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				contactId: 3,
				displayName: "Alice",
				aliases: [],
				relationshipLabels: [],
				importantDates: [{ label: "birthdate", date: "0000-03-20", isYearUnknown: true }],
				lastInteractionAt: null,
			}),
		});

		const result = await handleQueryBirthday({
			contactId: 3,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result).toEqual({
			status: "ok",
			birthday: "0000-03-20",
			isYearUnknown: true,
			contactId: 3,
		});
	});

	it("returns error when fetch throws", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));

		const result = await handleQueryBirthday({
			contactId: 1,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result.status).toBe("error");
		expect((result as { status: "error"; message: string }).message).toBeTruthy();
	});

	it("returns error when response is not ok", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: false,
			status: 404,
			text: async () => "Not found",
		});

		const result = await handleQueryBirthday({
			contactId: 999,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result.status).toBe("error");
	});

	it("passes correct URL path and options to serviceClient.fetch", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				contactId: 1,
				displayName: "Jane",
				aliases: [],
				relationshipLabels: [],
				importantDates: [],
				lastInteractionAt: null,
			}),
		});

		await handleQueryBirthday({
			contactId: 42,
			serviceClient,
			userId,
			correlationId,
		});

		expect(serviceClient.fetch).toHaveBeenCalledTimes(1);
		const [url, opts] = (serviceClient.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe("/internal/contacts/42");
		expect(opts.userId).toBe(userId);
		expect(opts.correlationId).toBe(correlationId);
		expect(opts.signal).toBeDefined();
	});
});
