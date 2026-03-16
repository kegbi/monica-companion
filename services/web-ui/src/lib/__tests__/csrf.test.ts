import { describe, expect, it } from "vitest";
import {
	buildCsrfCookieHeader,
	generateCsrfToken,
	getCsrfCookieName,
	validateCsrfToken,
	validateOrigin,
} from "../csrf";

describe("generateCsrfToken", () => {
	it("returns a hex-encoded string", () => {
		const token = generateCsrfToken();
		expect(token).toMatch(/^[0-9a-f]+$/);
	});

	it("returns a 64-character string (32 bytes hex)", () => {
		const token = generateCsrfToken();
		expect(token.length).toBe(64);
	});

	it("produces unique values", () => {
		const token1 = generateCsrfToken();
		const token2 = generateCsrfToken();
		expect(token1).not.toBe(token2);
	});
});

describe("getCsrfCookieName", () => {
	it("returns __Host-csrf in production (secure)", () => {
		expect(getCsrfCookieName(true)).toBe("__Host-csrf");
	});

	it("returns csrf in development (non-secure)", () => {
		expect(getCsrfCookieName(false)).toBe("csrf");
	});
});

describe("buildCsrfCookieHeader", () => {
	it("builds a production cookie with __Host- prefix, HttpOnly, Secure, SameSite=Strict, and Path=/", () => {
		const header = buildCsrfCookieHeader("abc123", true);
		expect(header).toContain("__Host-csrf=abc123");
		expect(header).toContain("HttpOnly");
		expect(header).toContain("Secure");
		expect(header).toContain("SameSite=Strict");
		// __Host- prefix requires Path=/ per RFC 6265bis
		expect(header).toContain("Path=/");
		expect(header).not.toContain("Path=/setup");
	});

	it("builds a development cookie without __Host- prefix and without Secure", () => {
		const header = buildCsrfCookieHeader("abc123", false);
		expect(header).toContain("csrf=abc123");
		expect(header).toContain("HttpOnly");
		expect(header).not.toContain("Secure");
		expect(header).toContain("SameSite=Strict");
		expect(header).toContain("Path=/setup");
	});
});

describe("validateCsrfToken", () => {
	it("returns true when cookie and form values match", () => {
		expect(validateCsrfToken("abc123def456", "abc123def456")).toBe(true);
	});

	it("returns false when values do not match", () => {
		expect(validateCsrfToken("abc123", "different")).toBe(false);
	});

	it("returns false when cookie is undefined", () => {
		expect(validateCsrfToken(undefined, "abc123")).toBe(false);
	});

	it("returns false when form value is undefined", () => {
		expect(validateCsrfToken("abc123", undefined)).toBe(false);
	});

	it("returns false when both are undefined", () => {
		expect(validateCsrfToken(undefined, undefined)).toBe(false);
	});

	it("returns false when values have different lengths", () => {
		expect(validateCsrfToken("short", "muchlongervalue")).toBe(false);
	});
});

describe("validateOrigin", () => {
	it("returns true when origin matches expected", () => {
		expect(validateOrigin("https://example.com", "https://example.com")).toBe(true);
	});

	it("returns false when origin does not match", () => {
		expect(validateOrigin("https://evil.com", "https://example.com")).toBe(false);
	});

	it("returns false when origin is undefined", () => {
		expect(validateOrigin(undefined, "https://example.com")).toBe(false);
	});

	it("returns false when origin is null", () => {
		expect(validateOrigin(null, "https://example.com")).toBe(false);
	});

	it("handles trailing slashes consistently", () => {
		expect(validateOrigin("https://example.com/", "https://example.com")).toBe(true);
		expect(validateOrigin("https://example.com", "https://example.com/")).toBe(true);
	});
});
