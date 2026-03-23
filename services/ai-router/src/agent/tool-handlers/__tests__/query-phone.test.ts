import type { ServiceClient } from "@monica-companion/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleQueryPhone } from "../query-phone.js";

function createMockServiceClient(): ServiceClient {
	return {
		fetch: vi.fn(),
	};
}

const userId = "550e8400-e29b-41d4-a716-446655440000";
const correlationId = "corr-test-phone";

describe("handleQueryPhone", () => {
	let serviceClient: ServiceClient;

	beforeEach(() => {
		vi.clearAllMocks();
		serviceClient = createMockServiceClient();
	});

	it("returns phone values when contact has phone fields", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{ fieldId: 1, type: "phone", typeName: "Phone", typeId: 2, value: "+1-555-1234" },
					{ fieldId: 2, type: "email", typeName: "Email", typeId: 1, value: "jane@example.com" },
				],
			}),
		});

		const result = await handleQueryPhone({
			contactId: 1,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result).toEqual({
			status: "ok",
			phones: [{ value: "+1-555-1234", typeName: "Phone" }],
			contactId: 1,
		});
	});

	it("returns empty array when contact has no phone fields", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{ fieldId: 2, type: "email", typeName: "Email", typeId: 1, value: "jane@example.com" },
				],
			}),
		});

		const result = await handleQueryPhone({
			contactId: 1,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result).toEqual({
			status: "ok",
			phones: [],
			contactId: 1,
		});
	});

	it("returns multiple phone fields when contact has several", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{ fieldId: 1, type: "phone", typeName: "Mobile", typeId: 2, value: "+1-555-1234" },
					{ fieldId: 3, type: "phone", typeName: "Work", typeId: 2, value: "+1-555-5678" },
				],
			}),
		});

		const result = await handleQueryPhone({
			contactId: 1,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result).toEqual({
			status: "ok",
			phones: [
				{ value: "+1-555-1234", typeName: "Mobile" },
				{ value: "+1-555-5678", typeName: "Work" },
			],
			contactId: 1,
		});
	});

	it("returns error when fetch throws", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));

		const result = await handleQueryPhone({
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
			text: async () => "Internal error",
		});

		const result = await handleQueryPhone({
			contactId: 1,
			serviceClient,
			userId,
			correlationId,
		});

		expect(result.status).toBe("error");
	});

	it("passes correct URL path to serviceClient.fetch", async () => {
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({ data: [] }),
		});

		await handleQueryPhone({
			contactId: 42,
			serviceClient,
			userId,
			correlationId,
		});

		const [url] = (serviceClient.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe("/internal/contacts/42/contact-fields");
	});
});
