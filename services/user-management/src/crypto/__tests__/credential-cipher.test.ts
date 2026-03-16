import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	decryptCredential,
	deriveEncryptionKey,
	encryptCredential,
	tryDecryptWithRotation,
} from "../credential-cipher";

function generateMasterKey(): Buffer {
	return randomBytes(32);
}

describe("deriveEncryptionKey", () => {
	it("returns a 32-byte buffer", () => {
		const masterKey = generateMasterKey();
		const derived = deriveEncryptionKey(masterKey);
		expect(derived).toBeInstanceOf(Buffer);
		expect(derived.length).toBe(32);
	});

	it("is deterministic for the same master key", () => {
		const masterKey = generateMasterKey();
		const derived1 = deriveEncryptionKey(masterKey);
		const derived2 = deriveEncryptionKey(masterKey);
		expect(derived1.equals(derived2)).toBe(true);
	});

	it("produces different keys for different master keys", () => {
		const key1 = generateMasterKey();
		const key2 = generateMasterKey();
		const derived1 = deriveEncryptionKey(key1);
		const derived2 = deriveEncryptionKey(key2);
		expect(derived1.equals(derived2)).toBe(false);
	});
});

describe("encryptCredential", () => {
	it("returns a non-empty base64 string", () => {
		const masterKey = generateMasterKey();
		const result = encryptCredential("my-secret-token", masterKey);
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
		// Should be valid base64
		expect(() => Buffer.from(result, "base64")).not.toThrow();
	});

	it("produces different ciphertexts for the same plaintext (fresh IV)", () => {
		const masterKey = generateMasterKey();
		const result1 = encryptCredential("same-plaintext", masterKey);
		const result2 = encryptCredential("same-plaintext", masterKey);
		expect(result1).not.toBe(result2);
	});
});

describe("decryptCredential", () => {
	it("round-trips correctly", () => {
		const masterKey = generateMasterKey();
		const plaintext = "my-secret-api-token-12345";
		const encrypted = encryptCredential(plaintext, masterKey);
		const decrypted = decryptCredential(encrypted, masterKey);
		expect(decrypted).toBe(plaintext);
	});

	it("round-trips empty string", () => {
		const masterKey = generateMasterKey();
		const encrypted = encryptCredential("", masterKey);
		const decrypted = decryptCredential(encrypted, masterKey);
		expect(decrypted).toBe("");
	});

	it("round-trips unicode content", () => {
		const masterKey = generateMasterKey();
		const plaintext = "token-with-unicode-\u{1F512}-\u{1F511}";
		const encrypted = encryptCredential(plaintext, masterKey);
		const decrypted = decryptCredential(encrypted, masterKey);
		expect(decrypted).toBe(plaintext);
	});

	it("throws on tampered ciphertext", () => {
		const masterKey = generateMasterKey();
		const encrypted = encryptCredential("secret", masterKey);
		const buf = Buffer.from(encrypted, "base64");
		// Tamper with the ciphertext portion (after 12-byte IV)
		buf[15] = buf[15] ^ 0xff;
		const tampered = buf.toString("base64");
		expect(() => decryptCredential(tampered, masterKey)).toThrow();
	});

	it("throws with wrong key", () => {
		const key1 = generateMasterKey();
		const key2 = generateMasterKey();
		const encrypted = encryptCredential("secret", key1);
		expect(() => decryptCredential(encrypted, key2)).toThrow();
	});
});

describe("tryDecryptWithRotation", () => {
	it("decrypts with current key and signals no re-encrypt needed", () => {
		const currentKey = generateMasterKey();
		const encrypted = encryptCredential("secret", currentKey);
		const result = tryDecryptWithRotation(encrypted, currentKey, null);
		expect(result.plaintext).toBe("secret");
		expect(result.needsReEncrypt).toBe(false);
	});

	it("falls back to previous key and signals re-encrypt needed", () => {
		const previousKey = generateMasterKey();
		const currentKey = generateMasterKey();
		const encrypted = encryptCredential("secret", previousKey);
		const result = tryDecryptWithRotation(encrypted, currentKey, previousKey);
		expect(result.plaintext).toBe("secret");
		expect(result.needsReEncrypt).toBe(true);
	});

	it("throws when neither key works", () => {
		const key1 = generateMasterKey();
		const key2 = generateMasterKey();
		const key3 = generateMasterKey();
		const encrypted = encryptCredential("secret", key1);
		expect(() => tryDecryptWithRotation(encrypted, key2, key3)).toThrow();
	});

	it("throws when current key fails and no previous key provided", () => {
		const key1 = generateMasterKey();
		const key2 = generateMasterKey();
		const encrypted = encryptCredential("secret", key1);
		expect(() => tryDecryptWithRotation(encrypted, key2, null)).toThrow();
	});
});
