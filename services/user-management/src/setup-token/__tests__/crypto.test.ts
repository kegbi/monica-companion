import { describe, expect, it } from "vitest";
import { buildSetupUrl, generateSetupToken, verifySetupTokenSignature } from "../crypto";

const TEST_SECRET = "test-setup-token-secret-32-bytes!";

const baseParams = {
	tokenId: "550e8400-e29b-41d4-a716-446655440000",
	telegramUserId: "123456789",
	step: "onboarding",
	expiresAtUnix: Math.floor(Date.now() / 1000) + 900,
};

describe("generateSetupToken", () => {
	it("returns a non-empty string for valid inputs", () => {
		const signature = generateSetupToken({ ...baseParams, secret: TEST_SECRET });
		expect(signature).toBeTruthy();
		expect(typeof signature).toBe("string");
		expect(signature.length).toBeGreaterThan(0);
	});

	it("produces URL-safe base64 output", () => {
		const signature = generateSetupToken({ ...baseParams, secret: TEST_SECRET });
		// URL-safe base64 uses - and _ instead of + and /
		expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("produces deterministic output for same inputs", () => {
		const sig1 = generateSetupToken({ ...baseParams, secret: TEST_SECRET });
		const sig2 = generateSetupToken({ ...baseParams, secret: TEST_SECRET });
		expect(sig1).toBe(sig2);
	});

	it("produces different output for different secrets", () => {
		const sig1 = generateSetupToken({ ...baseParams, secret: TEST_SECRET });
		const sig2 = generateSetupToken({ ...baseParams, secret: "different-secret-key-32-bytes!!" });
		expect(sig1).not.toBe(sig2);
	});
});

describe("verifySetupTokenSignature", () => {
	it("returns true for a matching signature", () => {
		const signature = generateSetupToken({ ...baseParams, secret: TEST_SECRET });
		const valid = verifySetupTokenSignature({ ...baseParams, signature, secret: TEST_SECRET });
		expect(valid).toBe(true);
	});

	it("returns false for a tampered tokenId", () => {
		const signature = generateSetupToken({ ...baseParams, secret: TEST_SECRET });
		const valid = verifySetupTokenSignature({
			...baseParams,
			tokenId: "00000000-0000-0000-0000-000000000000",
			signature,
			secret: TEST_SECRET,
		});
		expect(valid).toBe(false);
	});

	it("returns false for a tampered telegramUserId", () => {
		const signature = generateSetupToken({ ...baseParams, secret: TEST_SECRET });
		const valid = verifySetupTokenSignature({
			...baseParams,
			telegramUserId: "999999999",
			signature,
			secret: TEST_SECRET,
		});
		expect(valid).toBe(false);
	});

	it("returns false for a tampered step", () => {
		const signature = generateSetupToken({ ...baseParams, secret: TEST_SECRET });
		const valid = verifySetupTokenSignature({
			...baseParams,
			step: "other",
			signature,
			secret: TEST_SECRET,
		});
		expect(valid).toBe(false);
	});

	it("returns false for a tampered expiresAt", () => {
		const signature = generateSetupToken({ ...baseParams, secret: TEST_SECRET });
		const valid = verifySetupTokenSignature({
			...baseParams,
			expiresAtUnix: baseParams.expiresAtUnix + 1,
			signature,
			secret: TEST_SECRET,
		});
		expect(valid).toBe(false);
	});

	it("returns false for a wrong secret", () => {
		const signature = generateSetupToken({ ...baseParams, secret: TEST_SECRET });
		const valid = verifySetupTokenSignature({
			...baseParams,
			signature,
			secret: "wrong-secret-key-32-bytes!!!!!!",
		});
		expect(valid).toBe(false);
	});

	it("returns false for a completely invalid signature", () => {
		const valid = verifySetupTokenSignature({
			...baseParams,
			signature: "invalid-signature",
			secret: TEST_SECRET,
		});
		expect(valid).toBe(false);
	});
});

describe("buildSetupUrl", () => {
	it("produces the expected URL format", () => {
		const url = buildSetupUrl({
			baseUrl: "https://companion.example.com",
			tokenId: "550e8400-e29b-41d4-a716-446655440000",
			signature: "abc123_-",
		});
		expect(url).toBe(
			"https://companion.example.com/setup/550e8400-e29b-41d4-a716-446655440000?sig=abc123_-",
		);
	});

	it("handles base URL without trailing slash", () => {
		const url = buildSetupUrl({
			baseUrl: "http://localhost",
			tokenId: "my-token-id",
			signature: "sig-value",
		});
		expect(url).toBe("http://localhost/setup/my-token-id?sig=sig-value");
	});

	it("handles base URL with trailing slash", () => {
		const url = buildSetupUrl({
			baseUrl: "http://localhost/",
			tokenId: "my-token-id",
			signature: "sig-value",
		});
		expect(url).toBe("http://localhost/setup/my-token-id?sig=sig-value");
	});
});
