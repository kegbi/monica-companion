import type { ContactResolutionSummary } from "@monica-companion/types";
import { describe, expect, it, vi } from "vitest";
import { ContactResolutionClientError } from "../client.js";
import { resolveContact } from "../resolver.js";

// Mock the client module
vi.mock("../client.js", () => ({
	ContactResolutionClientError: class ContactResolutionClientError extends Error {
		constructor(message: string) {
			super(message);
			this.name = "ContactResolutionClientError";
		}
	},
	fetchContactSummaries: vi.fn(),
}));

// Import the mocked function for type-safe manipulation
import { fetchContactSummaries } from "../client.js";

const mockFetch = vi.mocked(fetchContactSummaries);

function makeSummary(
	overrides: Partial<ContactResolutionSummary> & { contactId: number },
): ContactResolutionSummary {
	return {
		displayName: `Contact ${overrides.contactId}`,
		aliases: [],
		relationshipLabels: [],
		importantDates: [],
		lastInteractionAt: null,
		...overrides,
	};
}

const mockServiceClient = { fetch: vi.fn() };

describe("resolveContact", () => {
	it("returns 'resolved' when single unambiguous match with score >= 0.90", async () => {
		const summary = makeSummary({
			contactId: 42,
			displayName: "John Doe (Johnny)",
			aliases: ["Johnny", "John", "Doe"],
			relationshipLabels: ["partner"],
		});
		mockFetch.mockResolvedValue([summary]);

		const result = await resolveContact(mockServiceClient, "user-123", "John Doe", "corr-1");

		expect(result.outcome).toBe("resolved");
		expect(result.resolved).not.toBeNull();
		expect(result.resolved?.contactId).toBe(42);
		expect(result.candidates).toEqual([]);
		expect(result.query).toBe("John Doe");
	});

	it("returns 'ambiguous' when two close matches", async () => {
		const summaries = [
			makeSummary({
				contactId: 10,
				displayName: "Sherry Miller",
				aliases: ["Sherry", "Miller"],
				lastInteractionAt: "2026-03-10T14:30:00Z",
			}),
			makeSummary({
				contactId: 20,
				displayName: "Sherry Chen",
				aliases: ["Sherry", "Chen"],
				lastInteractionAt: "2026-03-08T10:00:00Z",
			}),
		];
		mockFetch.mockResolvedValue(summaries);

		const result = await resolveContact(mockServiceClient, "user-123", "Sherry", "corr-2");

		expect(result.outcome).toBe("ambiguous");
		expect(result.resolved).toBeNull();
		expect(result.candidates.length).toBeGreaterThanOrEqual(2);
		expect(result.query).toBe("Sherry");
	});

	it("returns 'no_match' when no candidates", async () => {
		mockFetch.mockResolvedValue([]);

		const result = await resolveContact(mockServiceClient, "user-123", "Xavier", "corr-3");

		expect(result.outcome).toBe("no_match");
		expect(result.resolved).toBeNull();
		expect(result.candidates).toEqual([]);
		expect(result.query).toBe("Xavier");
	});

	it("returns 'no_match' when no candidate scores above minimum threshold", async () => {
		const summaries = [
			makeSummary({
				contactId: 42,
				displayName: "Completely Different Name",
				aliases: ["Nothing", "Related"],
			}),
		];
		mockFetch.mockResolvedValue(summaries);

		const result = await resolveContact(mockServiceClient, "user-123", "Xavier", "corr-4");

		expect(result.outcome).toBe("no_match");
	});

	it("propagates ContactResolutionClientError", async () => {
		mockFetch.mockRejectedValue(
			new ContactResolutionClientError("monica-integration returned status 502"),
		);

		await expect(resolveContact(mockServiceClient, "user-123", "John", "corr-5")).rejects.toThrow(
			ContactResolutionClientError,
		);
	});

	it("auto-resolves when only one candidate exists above minimum threshold even if score < 0.9", async () => {
		// "Elena" prefix-matches "Elena Yuryevna" at score 0.6 — the only candidate.
		// With no competing candidates, disambiguation is unnecessary friction.
		const summary = makeSummary({
			contactId: 682023,
			displayName: "Elena Yuryevna Rud",
			aliases: ["Elena", "Yuryevna"],
			relationshipLabels: ["parent"],
		});
		mockFetch.mockResolvedValue([summary]);

		const result = await resolveContact(mockServiceClient, "user-123", "Elena", "corr-single");

		expect(result.outcome).toBe("resolved");
		expect(result.resolved?.contactId).toBe(682023);
		expect(result.candidates).toEqual([]);
	});

	it("limits disambiguation candidates to MAX_DISAMBIGUATION_CANDIDATES", async () => {
		const summaries = Array.from({ length: 10 }, (_, i) =>
			makeSummary({
				contactId: i + 1,
				displayName: `Al ${i + 1}`,
				aliases: ["Al"],
			}),
		);
		mockFetch.mockResolvedValue(summaries);

		const result = await resolveContact(mockServiceClient, "user-123", "Al", "corr-6");

		expect(result.outcome).toBe("ambiguous");
		expect(result.candidates.length).toBeLessThanOrEqual(5);
	});

	it("returns 'resolved' for score >= 0.90 with sufficient gap to second", async () => {
		const summaries = [
			makeSummary({
				contactId: 42,
				displayName: "Mom",
				aliases: ["Mom"],
				relationshipLabels: ["parent"],
			}),
			makeSummary({
				contactId: 43,
				displayName: "Monkey Bar",
				aliases: ["Mo"],
			}),
		];
		mockFetch.mockResolvedValue(summaries);

		const result = await resolveContact(mockServiceClient, "user-123", "Mom", "corr-7");

		// Contact 42: relationship match 0.90
		// Contact 43: prefix "mo" matches "monkey" or alias "mo" but "mom" != "mo" and
		// "mom" is not a prefix of "mo" but "mo" is prefix of "mom" (wrong direction)
		// Actually "mom" is alias match for 42 (0.80) or relationship match (0.90)
		// "Mo" is an alias for 43; "mom" starts with "mo"? No, we check if alias starts with query
		// So 43 has no match. Result: resolved.
		expect(result.outcome).toBe("resolved");
		expect(result.resolved?.contactId).toBe(42);
	});
});
