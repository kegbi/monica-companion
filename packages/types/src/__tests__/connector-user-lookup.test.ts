import { describe, expect, it } from "vitest";
import { ConnectorUserLookupResponseSchema } from "../connector-user-lookup.js";

describe("ConnectorUserLookupResponseSchema", () => {
	it("parses a found response with userId", () => {
		const result = ConnectorUserLookupResponseSchema.safeParse({
			found: true,
			userId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.found).toBe(true);
			expect(result.data.userId).toBe("550e8400-e29b-41d4-a716-446655440000");
		}
	});

	it("parses a not-found response", () => {
		const result = ConnectorUserLookupResponseSchema.safeParse({
			found: false,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.found).toBe(false);
			expect(result.data.userId).toBeUndefined();
		}
	});

	it("rejects missing found field", () => {
		const result = ConnectorUserLookupResponseSchema.safeParse({
			userId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.success).toBe(false);
	});
});
