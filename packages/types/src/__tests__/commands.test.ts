import { describe, expect, it } from "vitest";
import {
	ConfirmedCommandPayloadSchema,
	MutatingCommandPayloadSchema,
	MutatingCommandType,
	PendingCommandRecordSchema,
	PendingCommandStatus,
	ReadOnlyCommandPayloadSchema,
	ReadOnlyCommandType,
} from "../commands.js";

describe("MutatingCommandType", () => {
	it("contains all expected mutating command types", () => {
		expect(MutatingCommandType.create_contact).toBe("create_contact");
		expect(MutatingCommandType.create_note).toBe("create_note");
		expect(MutatingCommandType.create_activity).toBe("create_activity");
		expect(MutatingCommandType.update_contact_birthday).toBe("update_contact_birthday");
		expect(MutatingCommandType.update_contact_phone).toBe("update_contact_phone");
		expect(MutatingCommandType.update_contact_email).toBe("update_contact_email");
		expect(MutatingCommandType.update_contact_address).toBe("update_contact_address");
	});
});

describe("ReadOnlyCommandType", () => {
	it("contains all expected read-only command types", () => {
		expect(ReadOnlyCommandType.query_birthday).toBe("query_birthday");
		expect(ReadOnlyCommandType.query_phone).toBe("query_phone");
		expect(ReadOnlyCommandType.query_last_note).toBe("query_last_note");
	});
});

describe("PendingCommandStatus", () => {
	it("contains all expected statuses", () => {
		expect(PendingCommandStatus.draft).toBe("draft");
		expect(PendingCommandStatus.pending_confirmation).toBe("pending_confirmation");
		expect(PendingCommandStatus.confirmed).toBe("confirmed");
		expect(PendingCommandStatus.executed).toBe("executed");
		expect(PendingCommandStatus.expired).toBe("expired");
		expect(PendingCommandStatus.cancelled).toBe("cancelled");
	});
});

describe("MutatingCommandPayload", () => {
	describe("create_contact", () => {
		it("parses a valid create_contact payload", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "create_contact",
				firstName: "John",
				lastName: "Doe",
				genderId: 1,
			});
			expect(result.success).toBe(true);
		});

		it("parses create_contact with birthdate", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "create_contact",
				firstName: "John",
				genderId: 1,
				birthdate: { day: 15, month: 1, year: 1990 },
			});
			expect(result.success).toBe(true);
		});

		it("rejects create_contact without firstName", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "create_contact",
				genderId: 1,
			});
			expect(result.success).toBe(false);
		});
	});

	describe("create_note", () => {
		it("parses a valid create_note payload", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "create_note",
				contactId: 42,
				body: "Met for coffee today",
			});
			expect(result.success).toBe(true);
		});

		it("rejects create_note without contactId", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "create_note",
				body: "Hello",
			});
			expect(result.success).toBe(false);
		});
	});

	describe("create_activity", () => {
		it("parses a valid create_activity payload", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "create_activity",
				summary: "Lunch meeting",
				happenedAt: "2026-03-15",
				contactIds: [42, 43],
			});
			expect(result.success).toBe(true);
		});

		it("parses create_activity with optional fields", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "create_activity",
				summary: "Dinner",
				happenedAt: "2026-03-15",
				contactIds: [42],
				description: "Great dinner at restaurant",
				activityTypeId: 1,
			});
			expect(result.success).toBe(true);
		});
	});

	describe("update_contact_birthday", () => {
		it("parses a valid update_contact_birthday payload", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "update_contact_birthday",
				contactId: 42,
				day: 15,
				month: 1,
				year: 1990,
			});
			expect(result.success).toBe(true);
		});

		it("parses update_contact_birthday without year (year unknown)", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "update_contact_birthday",
				contactId: 42,
				day: 15,
				month: 1,
			});
			expect(result.success).toBe(true);
		});
	});

	describe("update_contact_phone", () => {
		it("parses a valid update_contact_phone payload", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "update_contact_phone",
				contactId: 42,
				value: "+1-555-0123",
				/**
				 * contactFieldTypeId is a Monica-specific ID.
				 * Known V1 boundary pragmatism: AI must provide this ID directly.
				 * A future version should resolve type strings to IDs within monica-integration.
				 */
				contactFieldTypeId: 1,
			});
			expect(result.success).toBe(true);
		});
	});

	describe("update_contact_email", () => {
		it("parses a valid update_contact_email payload", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "update_contact_email",
				contactId: 42,
				value: "john@example.com",
				/**
				 * contactFieldTypeId is a Monica-specific ID.
				 * Known V1 boundary pragmatism.
				 */
				contactFieldTypeId: 2,
			});
			expect(result.success).toBe(true);
		});
	});

	describe("update_contact_address", () => {
		it("parses a valid update_contact_address payload", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "update_contact_address",
				contactId: 42,
				country: "US",
				street: "123 Main St",
				city: "Springfield",
			});
			expect(result.success).toBe(true);
		});

		it("parses update_contact_address with minimal fields", () => {
			const result = MutatingCommandPayloadSchema.safeParse({
				type: "update_contact_address",
				contactId: 42,
				country: "US",
			});
			expect(result.success).toBe(true);
		});
	});

	it("rejects an unknown command type", () => {
		const result = MutatingCommandPayloadSchema.safeParse({
			type: "unknown_command",
			foo: "bar",
		});
		expect(result.success).toBe(false);
	});
});

describe("ReadOnlyCommandPayload", () => {
	describe("query_birthday", () => {
		it("parses a valid query_birthday payload", () => {
			const result = ReadOnlyCommandPayloadSchema.safeParse({
				type: "query_birthday",
				contactId: 42,
			});
			expect(result.success).toBe(true);
		});
	});

	describe("query_phone", () => {
		it("parses a valid query_phone payload", () => {
			const result = ReadOnlyCommandPayloadSchema.safeParse({
				type: "query_phone",
				contactId: 42,
			});
			expect(result.success).toBe(true);
		});
	});

	describe("query_last_note", () => {
		it("parses a valid query_last_note payload", () => {
			const result = ReadOnlyCommandPayloadSchema.safeParse({
				type: "query_last_note",
				contactId: 42,
			});
			expect(result.success).toBe(true);
		});
	});

	it("rejects a mutating type in ReadOnlyCommandPayload", () => {
		const result = ReadOnlyCommandPayloadSchema.safeParse({
			type: "create_contact",
			firstName: "John",
			genderId: 1,
		});
		expect(result.success).toBe(false);
	});
});

describe("PendingCommandRecordSchema", () => {
	const validRecord = {
		id: "550e8400-e29b-41d4-a716-446655440000",
		userId: "550e8400-e29b-41d4-a716-446655440001",
		commandType: "create_contact" as const,
		payload: {
			type: "create_contact" as const,
			firstName: "John",
			genderId: 1,
		},
		status: "draft" as const,
		version: 1,
		sourceMessageRef: "telegram:msg:12345",
		correlationId: "corr-123",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
		confirmedAt: null,
		executedAt: null,
		terminalAt: null,
		executionResult: null,
	};

	it("parses a valid pending command record", () => {
		const result = PendingCommandRecordSchema.safeParse(validRecord);
		expect(result.success).toBe(true);
	});

	it("enforces commandType is MutatingCommandType (not ReadOnlyCommandType)", () => {
		const result = PendingCommandRecordSchema.safeParse({
			...validRecord,
			commandType: "query_birthday",
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid status", () => {
		const result = PendingCommandRecordSchema.safeParse({
			...validRecord,
			status: "unknown_status",
		});
		expect(result.success).toBe(false);
	});

	it("parses record with confirmed status and confirmedAt set", () => {
		const result = PendingCommandRecordSchema.safeParse({
			...validRecord,
			status: "confirmed",
			confirmedAt: new Date().toISOString(),
		});
		expect(result.success).toBe(true);
	});
});

describe("ConfirmedCommandPayloadSchema", () => {
	const validConfirmed = {
		pendingCommandId: "550e8400-e29b-41d4-a716-446655440000",
		userId: "550e8400-e29b-41d4-a716-446655440001",
		commandType: "create_note" as const,
		payload: {
			type: "create_note" as const,
			contactId: 42,
			body: "Hello world",
		},
		idempotencyKey: "550e8400-e29b-41d4-a716-446655440000:v2",
		correlationId: "corr-123",
		confirmedAt: new Date().toISOString(),
	};

	it("parses a valid confirmed command payload", () => {
		const result = ConfirmedCommandPayloadSchema.safeParse(validConfirmed);
		expect(result.success).toBe(true);
	});

	it("rejects missing idempotencyKey", () => {
		const { idempotencyKey, ...rest } = validConfirmed;
		const result = ConfirmedCommandPayloadSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects missing correlationId", () => {
		const { correlationId, ...rest } = validConfirmed;
		const result = ConfirmedCommandPayloadSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("enforces commandType is MutatingCommandType", () => {
		const result = ConfirmedCommandPayloadSchema.safeParse({
			...validConfirmed,
			commandType: "query_birthday",
		});
		expect(result.success).toBe(false);
	});

	it("accepts optional connectorType and connectorRoutingId", () => {
		const result = ConfirmedCommandPayloadSchema.safeParse({
			...validConfirmed,
			connectorType: "telegram",
			connectorRoutingId: "chat-123",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.connectorType).toBe("telegram");
			expect(result.data.connectorRoutingId).toBe("chat-123");
		}
	});

	it("parses without connectorType and connectorRoutingId (backward compat)", () => {
		const result = ConfirmedCommandPayloadSchema.safeParse(validConfirmed);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.connectorType).toBeUndefined();
			expect(result.data.connectorRoutingId).toBeUndefined();
		}
	});
});
