import { describe, expect, it } from "vitest";
import { DeliveryResponseSchema, DeliveryResponseStatusSchema } from "../delivery.js";

describe("DeliveryResponseStatusSchema", () => {
	it("accepts 'delivered'", () => {
		const result = DeliveryResponseStatusSchema.safeParse("delivered");
		expect(result.success).toBe(true);
	});

	it("accepts 'failed'", () => {
		const result = DeliveryResponseStatusSchema.safeParse("failed");
		expect(result.success).toBe(true);
	});

	it("accepts 'rejected'", () => {
		const result = DeliveryResponseStatusSchema.safeParse("rejected");
		expect(result.success).toBe(true);
	});

	it("rejects invalid status 'pending'", () => {
		const result = DeliveryResponseStatusSchema.safeParse("pending");
		expect(result.success).toBe(false);
	});

	it("rejects invalid status 'unknown'", () => {
		const result = DeliveryResponseStatusSchema.safeParse("unknown");
		expect(result.success).toBe(false);
	});
});

describe("DeliveryResponseSchema", () => {
	it("accepts a delivered response", () => {
		const result = DeliveryResponseSchema.safeParse({
			deliveryId: "550e8400-e29b-41d4-a716-446655440000",
			status: "delivered",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.deliveryId).toBe("550e8400-e29b-41d4-a716-446655440000");
			expect(result.data.status).toBe("delivered");
			expect(result.data.error).toBeUndefined();
		}
	});

	it("accepts a failed response with error", () => {
		const result = DeliveryResponseSchema.safeParse({
			deliveryId: "550e8400-e29b-41d4-a716-446655440000",
			status: "failed",
			error: "timeout",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.status).toBe("failed");
			expect(result.data.error).toBe("timeout");
		}
	});

	it("accepts a rejected response with error", () => {
		const result = DeliveryResponseSchema.safeParse({
			deliveryId: "550e8400-e29b-41d4-a716-446655440000",
			status: "rejected",
			error: "unsupported connector",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.status).toBe("rejected");
		}
	});

	it("rejects missing deliveryId", () => {
		const result = DeliveryResponseSchema.safeParse({
			status: "delivered",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing status", () => {
		const result = DeliveryResponseSchema.safeParse({
			deliveryId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid status value", () => {
		const result = DeliveryResponseSchema.safeParse({
			deliveryId: "550e8400-e29b-41d4-a716-446655440000",
			status: "pending",
		});
		expect(result.success).toBe(false);
	});
});
