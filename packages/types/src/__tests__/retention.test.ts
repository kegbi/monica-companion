import { describe, expect, it } from "vitest";
import {
	AiRouterRetentionCleanupRequestSchema,
	DeliveryRetentionCleanupRequestSchema,
	DisconnectUserResponseSchema,
	RetentionCleanupResponseSchema,
	UserDataPurgeResponseSchema,
} from "../retention.js";

describe("AiRouterRetentionCleanupRequestSchema", () => {
	it("accepts valid payload with ISO date string", () => {
		const result = AiRouterRetentionCleanupRequestSchema.safeParse({
			conversationHistoryCutoff: "2024-01-01T00:00:00.000Z",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.conversationHistoryCutoff).toBe("2024-01-01T00:00:00.000Z");
		}
	});

	it("rejects missing conversationHistoryCutoff", () => {
		const result = AiRouterRetentionCleanupRequestSchema.safeParse({});
		expect(result.success).toBe(false);
	});

	it("rejects non-ISO date string", () => {
		const result = AiRouterRetentionCleanupRequestSchema.safeParse({
			conversationHistoryCutoff: "not-a-date",
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty object", () => {
		const result = AiRouterRetentionCleanupRequestSchema.safeParse({});
		expect(result.success).toBe(false);
	});
});

describe("DeliveryRetentionCleanupRequestSchema", () => {
	it("accepts valid payload with ISO date string", () => {
		const result = DeliveryRetentionCleanupRequestSchema.safeParse({
			deliveryAuditsCutoff: "2024-01-01T00:00:00.000Z",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.deliveryAuditsCutoff).toBe("2024-01-01T00:00:00.000Z");
		}
	});

	it("rejects missing deliveryAuditsCutoff", () => {
		const result = DeliveryRetentionCleanupRequestSchema.safeParse({});
		expect(result.success).toBe(false);
	});

	it("rejects non-ISO date string", () => {
		const result = DeliveryRetentionCleanupRequestSchema.safeParse({
			deliveryAuditsCutoff: "not-a-date",
		});
		expect(result.success).toBe(false);
	});
});

describe("RetentionCleanupResponseSchema", () => {
	it("accepts valid response with purge counts", () => {
		const result = RetentionCleanupResponseSchema.safeParse({
			purged: { conversationHistory: 10 },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.purged.conversationHistory).toBe(10);
		}
	});

	it("accepts empty purge counts", () => {
		const result = RetentionCleanupResponseSchema.safeParse({
			purged: {},
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing purged field", () => {
		const result = RetentionCleanupResponseSchema.safeParse({});
		expect(result.success).toBe(false);
	});

	it("rejects non-number values in purged", () => {
		const result = RetentionCleanupResponseSchema.safeParse({
			purged: { conversationHistory: "ten" },
		});
		expect(result.success).toBe(false);
	});
});

describe("UserDataPurgeResponseSchema", () => {
	it("accepts valid response with purge counts", () => {
		const result = UserDataPurgeResponseSchema.safeParse({
			purged: { conversationHistory: 10 },
		});
		expect(result.success).toBe(true);
	});

	it("rejects missing purged field", () => {
		const result = UserDataPurgeResponseSchema.safeParse({});
		expect(result.success).toBe(false);
	});
});

describe("DisconnectUserResponseSchema", () => {
	it("accepts valid disconnect response", () => {
		const result = DisconnectUserResponseSchema.safeParse({
			disconnected: true,
			purgeScheduledAt: "2024-02-01T00:00:00.000Z",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.disconnected).toBe(true);
			expect(result.data.purgeScheduledAt).toBe("2024-02-01T00:00:00.000Z");
		}
	});

	it("rejects missing disconnected field", () => {
		const result = DisconnectUserResponseSchema.safeParse({
			purgeScheduledAt: "2024-02-01T00:00:00.000Z",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing purgeScheduledAt field", () => {
		const result = DisconnectUserResponseSchema.safeParse({
			disconnected: true,
		});
		expect(result.success).toBe(false);
	});

	it("rejects non-boolean disconnected", () => {
		const result = DisconnectUserResponseSchema.safeParse({
			disconnected: "yes",
			purgeScheduledAt: "2024-02-01T00:00:00.000Z",
		});
		expect(result.success).toBe(false);
	});
});
