import { ConfirmedCommandPayloadSchema } from "@monica-companion/types";
import { describe, expect, it } from "vitest";
import { buildConfirmedPayload } from "../confirm.js";
import type { PendingCommandRow } from "../repository.js";

describe("buildConfirmedPayload", () => {
	const makeRecord = (overrides: Partial<PendingCommandRow> = {}): PendingCommandRow =>
		({
			id: "550e8400-e29b-41d4-a716-446655440000",
			userId: "550e8400-e29b-41d4-a716-446655440001",
			commandType: "create_note",
			payload: { type: "create_note", contactId: 42, body: "Hello" },
			status: "confirmed",
			version: 3,
			sourceMessageRef: "telegram:msg:12345",
			correlationId: "corr-abc",
			createdAt: new Date("2026-03-16T10:00:00Z"),
			updatedAt: new Date("2026-03-16T10:05:00Z"),
			expiresAt: new Date("2026-03-16T10:30:00Z"),
			confirmedAt: new Date("2026-03-16T10:05:00Z"),
			executedAt: null,
			terminalAt: null,
			executionResult: null,
			...overrides,
		}) as PendingCommandRow;

	it("builds a valid ConfirmedCommandPayload", () => {
		const record = makeRecord();
		const result = buildConfirmedPayload(record);

		expect(result.pendingCommandId).toBe(record.id);
		expect(result.userId).toBe(record.userId);
		expect(result.commandType).toBe("create_note");
		expect(result.payload).toEqual(record.payload);
		expect(result.correlationId).toBe(record.correlationId);
		expect(result.confirmedAt).toBeDefined();
	});

	it("generates deterministic idempotencyKey from id and version", () => {
		const record = makeRecord({ version: 3 });
		const result = buildConfirmedPayload(record);

		expect(result.idempotencyKey).toBe("550e8400-e29b-41d4-a716-446655440000:v3");
	});

	it("produces a payload that passes ConfirmedCommandPayloadSchema validation", () => {
		const record = makeRecord();
		const result = buildConfirmedPayload(record);
		const parsed = ConfirmedCommandPayloadSchema.safeParse(result);

		expect(parsed.success).toBe(true);
	});

	it("uses confirmedAt from record when available", () => {
		const confirmedAt = new Date("2026-03-16T10:05:00Z");
		const record = makeRecord({ confirmedAt });
		const result = buildConfirmedPayload(record);

		expect(result.confirmedAt).toBe(confirmedAt.toISOString());
	});

	it("falls back to current time when confirmedAt is null", () => {
		const before = new Date();
		const record = makeRecord({ confirmedAt: null });
		const result = buildConfirmedPayload(record);
		const after = new Date();

		const resultDate = new Date(result.confirmedAt);
		expect(resultDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
		expect(resultDate.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
	});

	it("generates different idempotency keys for different versions", () => {
		const v1 = buildConfirmedPayload(makeRecord({ version: 1 }));
		const v2 = buildConfirmedPayload(makeRecord({ version: 2 }));

		expect(v1.idempotencyKey).not.toBe(v2.idempotencyKey);
	});
});
