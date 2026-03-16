import { describe, expect, it } from "vitest";
import { assertTransition, isActive, isTerminal } from "../state-machine.js";

describe("state-machine", () => {
	describe("assertTransition", () => {
		it("allows draft -> pending_confirmation", () => {
			expect(() => assertTransition("draft", "pending_confirmation")).not.toThrow();
		});

		it("allows draft -> cancelled", () => {
			expect(() => assertTransition("draft", "cancelled")).not.toThrow();
		});

		it("allows pending_confirmation -> confirmed", () => {
			expect(() => assertTransition("pending_confirmation", "confirmed")).not.toThrow();
		});

		it("allows pending_confirmation -> cancelled", () => {
			expect(() => assertTransition("pending_confirmation", "cancelled")).not.toThrow();
		});

		it("allows pending_confirmation -> expired", () => {
			expect(() => assertTransition("pending_confirmation", "expired")).not.toThrow();
		});

		it("allows pending_confirmation -> draft (edit/disambiguation)", () => {
			expect(() => assertTransition("pending_confirmation", "draft")).not.toThrow();
		});

		it("allows confirmed -> executed", () => {
			expect(() => assertTransition("confirmed", "executed")).not.toThrow();
		});

		it("allows draft -> expired", () => {
			expect(() => assertTransition("draft", "expired")).not.toThrow();
		});

		it("rejects draft -> executed", () => {
			expect(() => assertTransition("draft", "executed")).toThrow("Invalid transition");
		});

		it("rejects executed -> draft", () => {
			expect(() => assertTransition("executed", "draft")).toThrow("Invalid transition");
		});

		it("rejects expired -> confirmed", () => {
			expect(() => assertTransition("expired", "confirmed")).toThrow("Invalid transition");
		});

		it("rejects cancelled -> confirmed", () => {
			expect(() => assertTransition("cancelled", "confirmed")).toThrow("Invalid transition");
		});

		it("rejects confirmed -> draft", () => {
			expect(() => assertTransition("confirmed", "draft")).toThrow("Invalid transition");
		});

		it("rejects same-state transitions", () => {
			expect(() => assertTransition("draft", "draft")).toThrow("Invalid transition");
		});
	});

	describe("isTerminal", () => {
		it("returns true for executed", () => {
			expect(isTerminal("executed")).toBe(true);
		});

		it("returns true for expired", () => {
			expect(isTerminal("expired")).toBe(true);
		});

		it("returns true for cancelled", () => {
			expect(isTerminal("cancelled")).toBe(true);
		});

		it("returns false for draft", () => {
			expect(isTerminal("draft")).toBe(false);
		});

		it("returns false for pending_confirmation", () => {
			expect(isTerminal("pending_confirmation")).toBe(false);
		});

		it("returns false for confirmed", () => {
			expect(isTerminal("confirmed")).toBe(false);
		});
	});

	describe("isActive", () => {
		it("returns true for draft", () => {
			expect(isActive("draft")).toBe(true);
		});

		it("returns true for pending_confirmation", () => {
			expect(isActive("pending_confirmation")).toBe(true);
		});

		it("returns true for confirmed", () => {
			expect(isActive("confirmed")).toBe(true);
		});

		it("returns false for executed", () => {
			expect(isActive("executed")).toBe(false);
		});

		it("returns false for expired", () => {
			expect(isActive("expired")).toBe(false);
		});

		it("returns false for cancelled", () => {
			expect(isActive("cancelled")).toBe(false);
		});
	});
});
