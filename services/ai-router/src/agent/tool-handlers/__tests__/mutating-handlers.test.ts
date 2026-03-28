import type { ServiceClient } from "@monica-companion/auth";
import type { ConfirmedCommandPayload } from "@monica-companion/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SchedulerClient } from "../../../lib/scheduler-client.js";
import {
	executeMutatingTool,
	fetchContactFieldTypeId,
	parseDateString,
} from "../mutating-handlers.js";

function createMockSchedulerClient(): SchedulerClient {
	return {
		execute: vi.fn().mockResolvedValue({ executionId: "exec-123", status: "queued" }),
	};
}

function createMockServiceClient(): ServiceClient {
	return {
		fetch: vi.fn(),
	};
}

const userId = "550e8400-e29b-41d4-a716-446655440000";
const correlationId = "corr-test-mutating";
const pendingCommandId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("executeMutatingTool", () => {
	let schedulerClient: SchedulerClient;
	let monicaServiceClient: ServiceClient;

	beforeEach(() => {
		vi.clearAllMocks();
		schedulerClient = createMockSchedulerClient();
		monicaServiceClient = createMockServiceClient();
	});

	it("executes create_note with correct payload", async () => {
		const result = await executeMutatingTool({
			toolName: "create_note",
			args: { contact_id: 1, body: "Had coffee today" },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		expect(result.status).toBe("success");
		expect(schedulerClient.execute).toHaveBeenCalledTimes(1);

		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect(payload.commandType).toBe("create_note");
		expect(payload.payload).toEqual({
			type: "create_note",
			contactId: 1,
			body: "Had coffee today",
		});
		expect(payload.userId).toBe(userId);
		expect(payload.correlationId).toBe(correlationId);
		expect(payload.pendingCommandId).toBe(pendingCommandId);
	});

	it("executes create_contact with firstName, lastName, and default genderId", async () => {
		const result = await executeMutatingTool({
			toolName: "create_contact",
			args: { first_name: "Jane", last_name: "Doe" },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		expect(result.status).toBe("success");
		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect(payload.payload).toEqual({
			type: "create_contact",
			firstName: "Jane",
			lastName: "Doe",
			genderId: 3, // default "Rather not say"
		});
	});

	it("create_contact passes nickname when provided", async () => {
		await executeMutatingTool({
			toolName: "create_contact",
			args: { first_name: "John", last_name: "Doe", nickname: "Johnny" },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect(payload.payload).toMatchObject({
			type: "create_contact",
			firstName: "John",
			lastName: "Doe",
			nickname: "Johnny",
			genderId: 3,
		});
	});

	it("executes update_contact_nickname with correct payload", async () => {
		const result = await executeMutatingTool({
			toolName: "update_contact_nickname",
			args: { contact_id: 10, nickname: "Johnny" },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		expect(result.status).toBe("success");
		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect(payload.payload).toEqual({
			type: "update_contact_nickname",
			contactId: 10,
			nickname: "Johnny",
		});
	});

	it("executes update_contact_nickname with empty string to remove", async () => {
		await executeMutatingTool({
			toolName: "update_contact_nickname",
			args: { contact_id: 10, nickname: "" },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect(payload.payload).toEqual({
			type: "update_contact_nickname",
			contactId: 10,
			nickname: "",
		});
	});

	it("create_contact uses provided genderId when given", async () => {
		await executeMutatingTool({
			toolName: "create_contact",
			args: { first_name: "Bob", gender_id: 1 },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect(payload.payload).toMatchObject({ genderId: 1 });
	});

	it("executes create_activity with description mapped to summary", async () => {
		await executeMutatingTool({
			toolName: "create_activity",
			args: { contact_ids: [1, 2], description: "Had lunch" },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect(payload.payload).toMatchObject({
			type: "create_activity",
			summary: "Had lunch",
			contactIds: [1, 2],
			activityTypeId: null,
		});
		// happenedAt should default to today's date
		expect((payload.payload as { happenedAt: string }).happenedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("create_activity uses provided date", async () => {
		await executeMutatingTool({
			toolName: "create_activity",
			args: { contact_ids: [3], description: "Meeting", date: "2026-03-20" },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect((payload.payload as { happenedAt: string }).happenedAt).toBe("2026-03-20");
	});

	it("executes update_contact_birthday with parsed date", async () => {
		await executeMutatingTool({
			toolName: "update_contact_birthday",
			args: { contact_id: 5, date: "1990-05-15" },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect(payload.payload).toEqual({
			type: "update_contact_birthday",
			contactId: 5,
			day: 15,
			month: 5,
			year: 1990,
		});
	});

	it("executes update_contact_phone with resolved contactFieldTypeId", async () => {
		(monicaServiceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{ id: 1, name: "Email", type: "email" },
					{ id: 2, name: "Phone", type: "phone" },
				],
			}),
		});

		await executeMutatingTool({
			toolName: "update_contact_phone",
			args: { contact_id: 10, phone_number: "+1-555-0100" },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect(payload.payload).toEqual({
			type: "update_contact_phone",
			contactId: 10,
			value: "+1-555-0100",
			contactFieldTypeId: 2,
		});
	});

	it("executes update_contact_email with resolved contactFieldTypeId", async () => {
		(monicaServiceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{ id: 1, name: "Email", type: "email" },
					{ id: 2, name: "Phone", type: "phone" },
				],
			}),
		});

		await executeMutatingTool({
			toolName: "update_contact_email",
			args: { contact_id: 10, email: "jane@example.com" },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect(payload.payload).toEqual({
			type: "update_contact_email",
			contactId: 10,
			value: "jane@example.com",
			contactFieldTypeId: 1,
		});
	});

	it("executes update_contact_address with mapped fields and defaults", async () => {
		await executeMutatingTool({
			toolName: "update_contact_address",
			args: {
				contact_id: 7,
				street: "123 Main St",
				city: "Portland",
				postal_code: "97201",
			},
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect(payload.payload).toEqual({
			type: "update_contact_address",
			contactId: 7,
			name: "Main",
			street: "123 Main St",
			city: "Portland",
			postalCode: "97201",
			country: "US",
		});
	});

	it("returns error when scheduler fails", async () => {
		(schedulerClient.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("scheduler timeout"),
		);

		const result = await executeMutatingTool({
			toolName: "create_note",
			args: { contact_id: 1, body: "Test" },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		expect(result.status).toBe("error");
		expect((result as { status: "error"; message: string }).message).toBeTruthy();
	});

	it("returns error for unknown tool name", async () => {
		const result = await executeMutatingTool({
			toolName: "unknown_tool",
			args: {},
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		expect(result.status).toBe("error");
		expect((result as { status: "error"; message: string }).message).toContain("unknown_tool");
	});

	it("uses PENDING_COMMAND_VERSION in idempotency key", async () => {
		await executeMutatingTool({
			toolName: "create_note",
			args: { contact_id: 1, body: "Test" },
			userId,
			correlationId,
			pendingCommandId,
			schedulerClient,
			monicaServiceClient,
		});

		const payload = (schedulerClient.execute as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as ConfirmedCommandPayload;
		expect(payload.idempotencyKey).toBe(`${pendingCommandId}:v1`);
	});
});

describe("fetchContactFieldTypeId", () => {
	it("returns correct ID for phone", async () => {
		const serviceClient = createMockServiceClient();
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{ id: 1, name: "Email", type: "email" },
					{ id: 2, name: "Phone", type: "phone" },
				],
			}),
		});

		const id = await fetchContactFieldTypeId(serviceClient, userId, correlationId, "phone");
		expect(id).toBe(2);
	});

	it("throws when type is not found", async () => {
		const serviceClient = createMockServiceClient();
		(serviceClient.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [{ id: 1, name: "Email", type: "email" }],
			}),
		});

		await expect(
			fetchContactFieldTypeId(serviceClient, userId, correlationId, "phone"),
		).rejects.toThrow("phone");
	});
});

describe("parseDateString", () => {
	it("parses a valid YYYY-MM-DD string", () => {
		const result = parseDateString("2024-03-15");
		expect(result).toEqual({ day: 15, month: 3, year: 2024 });
	});

	it("throws on invalid format", () => {
		expect(() => parseDateString("not-a-date")).toThrow();
	});

	it("throws on empty string", () => {
		expect(() => parseDateString("")).toThrow();
	});
});
