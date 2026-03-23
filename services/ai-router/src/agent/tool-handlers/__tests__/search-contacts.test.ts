import type { ServiceClient } from "@monica-companion/auth";
import type { ContactResolutionSummary } from "@monica-companion/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleSearchContacts } from "../search-contacts.js";

function createMockServiceClient(): ServiceClient {
	return {
		fetch: vi.fn(),
	};
}

function makeSummary(overrides: Partial<ContactResolutionSummary> = {}): ContactResolutionSummary {
	return {
		contactId: 1,
		displayName: "Jane Doe",
		aliases: ["Jane", "Doe"],
		relationshipLabels: [],
		importantDates: [],
		lastInteractionAt: null,
		...overrides,
	};
}

// Mock the contact-resolution client
vi.mock("../../../contact-resolution/client.js", () => ({
	fetchContactSummaries: vi.fn(),
}));

// Mock the contact-resolution matcher
vi.mock("../../../contact-resolution/matcher.js", () => ({
	matchContacts: vi.fn(),
}));

import { fetchContactSummaries } from "../../../contact-resolution/client.js";
import { matchContacts } from "../../../contact-resolution/matcher.js";

const mockedFetchContactSummaries = vi.mocked(fetchContactSummaries);
const mockedMatchContacts = vi.mocked(matchContacts);

const userId = "550e8400-e29b-41d4-a716-446655440000";
const correlationId = "corr-test-search";

describe("handleSearchContacts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns matched contacts with aliases, relationshipLabels, birthdate, and matchReason", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({
				contactId: 1,
				displayName: "Jane Doe",
				aliases: ["Jane", "Doe", "JD"],
				relationshipLabels: ["friend"],
				importantDates: [{ label: "birthdate", date: "1990-05-15", isYearUnknown: false }],
			}),
			makeSummary({
				contactId: 2,
				displayName: "Jane Smith",
				aliases: ["Jane", "Smith"],
				relationshipLabels: ["colleague"],
				importantDates: [],
			}),
			makeSummary({
				contactId: 3,
				displayName: "Janet Williams",
				aliases: ["Janet", "Williams"],
				relationshipLabels: [],
				importantDates: [{ label: "birthdate", date: "1985-12-01", isYearUnknown: true }],
			}),
		];

		mockedFetchContactSummaries.mockResolvedValue(summaries);
		mockedMatchContacts.mockReturnValue([
			{ contactId: 1, displayName: "Jane Doe", score: 1.0, matchReason: "exact_display_name" },
			{
				contactId: 2,
				displayName: "Jane Smith",
				score: 0.8,
				matchReason: "alias_match",
			},
			{
				contactId: 3,
				displayName: "Janet Williams",
				score: 0.6,
				matchReason: "partial_match",
			},
		]);

		const serviceClient = createMockServiceClient();
		const result = await handleSearchContacts({
			query: "Jane",
			serviceClient,
			userId,
			correlationId,
		});

		expect(result).toEqual({
			status: "ok",
			contacts: [
				{
					contactId: 1,
					displayName: "Jane Doe",
					aliases: ["Jane", "Doe", "JD"],
					relationshipLabels: ["friend"],
					birthdate: "1990-05-15",
					matchReason: "exact_display_name",
				},
				{
					contactId: 2,
					displayName: "Jane Smith",
					aliases: ["Jane", "Smith"],
					relationshipLabels: ["colleague"],
					birthdate: null,
					matchReason: "alias_match",
				},
				{
					contactId: 3,
					displayName: "Janet Williams",
					aliases: ["Janet", "Williams"],
					relationshipLabels: [],
					birthdate: "1985-12-01",
					matchReason: "partial_match",
				},
			],
		});
	});

	it("returns empty contacts array when there are no matches", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({ contactId: 1, displayName: "Alice Walker" }),
		];

		mockedFetchContactSummaries.mockResolvedValue(summaries);
		mockedMatchContacts.mockReturnValue([]);

		const serviceClient = createMockServiceClient();
		const result = await handleSearchContacts({
			query: "Bob",
			serviceClient,
			userId,
			correlationId,
		});

		expect(result).toEqual({ status: "ok", contacts: [] });
	});

	it("returns structured error when fetchContactSummaries throws", async () => {
		mockedFetchContactSummaries.mockRejectedValue(new Error("Service unavailable"));

		const serviceClient = createMockServiceClient();
		const result = await handleSearchContacts({
			query: "Jane",
			serviceClient,
			userId,
			correlationId,
		});

		expect(result.status).toBe("error");
		expect(result).toHaveProperty("message");
		expect((result as { status: "error"; message: string }).message).toContain("contact search");
	});

	it("caps results at 10 contacts", async () => {
		const summaries: ContactResolutionSummary[] = Array.from({ length: 15 }, (_, i) =>
			makeSummary({
				contactId: i + 1,
				displayName: `Person ${i + 1}`,
				aliases: [`Person${i + 1}`],
			}),
		);

		const matchCandidates = Array.from({ length: 15 }, (_, i) => ({
			contactId: i + 1,
			displayName: `Person ${i + 1}`,
			score: 0.8 - i * 0.01,
			matchReason: "alias_match" as const,
		}));

		mockedFetchContactSummaries.mockResolvedValue(summaries);
		mockedMatchContacts.mockReturnValue(matchCandidates);

		const serviceClient = createMockServiceClient();
		const result = await handleSearchContacts({
			query: "Person",
			serviceClient,
			userId,
			correlationId,
		});

		expect(result.status).toBe("ok");
		expect((result as { status: "ok"; contacts: unknown[] }).contacts).toHaveLength(10);
	});

	it("extracts birthdate from importantDates correctly", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({
				contactId: 1,
				displayName: "Jane Doe",
				importantDates: [
					{ label: "anniversary", date: "2020-06-15", isYearUnknown: false },
					{ label: "birthdate", date: "1990-05-15", isYearUnknown: false },
				],
			}),
		];

		mockedFetchContactSummaries.mockResolvedValue(summaries);
		mockedMatchContacts.mockReturnValue([
			{ contactId: 1, displayName: "Jane Doe", score: 1.0, matchReason: "exact_display_name" },
		]);

		const serviceClient = createMockServiceClient();
		const result = await handleSearchContacts({
			query: "Jane",
			serviceClient,
			userId,
			correlationId,
		});

		expect(result.status).toBe("ok");
		const contacts = (result as { status: "ok"; contacts: Array<{ birthdate: string | null }> })
			.contacts;
		expect(contacts[0].birthdate).toBe("1990-05-15");
	});

	it("returns null birthdate when no birthdate in importantDates", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({
				contactId: 1,
				displayName: "Jane Doe",
				importantDates: [{ label: "anniversary", date: "2020-06-15", isYearUnknown: false }],
			}),
		];

		mockedFetchContactSummaries.mockResolvedValue(summaries);
		mockedMatchContacts.mockReturnValue([
			{ contactId: 1, displayName: "Jane Doe", score: 1.0, matchReason: "exact_display_name" },
		]);

		const serviceClient = createMockServiceClient();
		const result = await handleSearchContacts({
			query: "Jane",
			serviceClient,
			userId,
			correlationId,
		});

		expect(result.status).toBe("ok");
		const contacts = (result as { status: "ok"; contacts: Array<{ birthdate: string | null }> })
			.contacts;
		expect(contacts[0].birthdate).toBeNull();
	});

	it("calls fetchContactSummaries with correct parameters", async () => {
		mockedFetchContactSummaries.mockResolvedValue([]);
		mockedMatchContacts.mockReturnValue([]);

		const serviceClient = createMockServiceClient();
		await handleSearchContacts({
			query: "test",
			serviceClient,
			userId,
			correlationId,
		});

		expect(mockedFetchContactSummaries).toHaveBeenCalledWith(serviceClient, userId, correlationId);
	});

	it("calls matchContacts with query and fetched summaries", async () => {
		const summaries: ContactResolutionSummary[] = [
			makeSummary({ contactId: 1, displayName: "Jane Doe" }),
		];

		mockedFetchContactSummaries.mockResolvedValue(summaries);
		mockedMatchContacts.mockReturnValue([]);

		const serviceClient = createMockServiceClient();
		await handleSearchContacts({
			query: "Jane",
			serviceClient,
			userId,
			correlationId,
		});

		expect(mockedMatchContacts).toHaveBeenCalledWith("Jane", summaries);
	});
});
