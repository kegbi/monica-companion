import { describe, expect, it } from "vitest";
import { decodeCallbackData, encodeCallbackData } from "../callback-data";

describe("callback-data", () => {
	describe("encodeCallbackData", () => {
		it("encodes action, pendingCommandId, and version", () => {
			const encoded = encodeCallbackData("confirm", "cmd-123", 1);
			expect(encoded).toBe("confirm:cmd-123:1");
		});

		it("roundtrips with decodeCallbackData", () => {
			const encoded = encodeCallbackData("cancel", "cmd-abc-def", 3);
			const decoded = decodeCallbackData(encoded);
			expect(decoded).toEqual({
				action: "cancel",
				pendingCommandId: "cmd-abc-def",
				version: 3,
			});
		});

		it("throws when encoded data exceeds 64 bytes", () => {
			const longId = "a".repeat(60);
			expect(() => encodeCallbackData("confirm", longId, 1)).toThrow("64-byte");
		});
	});

	describe("decodeCallbackData", () => {
		it("decodes valid callback data", () => {
			const result = decodeCallbackData("edit:pending-cmd-uuid:2");
			expect(result).toEqual({
				action: "edit",
				pendingCommandId: "pending-cmd-uuid",
				version: 2,
			});
		});

		it("returns null for invalid format", () => {
			expect(decodeCallbackData("invalid")).toBeNull();
			expect(decodeCallbackData("")).toBeNull();
			expect(decodeCallbackData("a:b")).toBeNull();
		});

		it("returns null for non-numeric version", () => {
			expect(decodeCallbackData("confirm:cmd-id:abc")).toBeNull();
		});
	});
});
