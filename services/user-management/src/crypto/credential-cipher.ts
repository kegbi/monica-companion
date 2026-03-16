import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = "aes-256-gcm";
const HKDF_INFO = "monica-credential-encryption";
const HKDF_SALT = Buffer.from("monica-companion-credential-encryption-v1");

/**
 * Derive a 256-bit encryption key from the master key using HKDF-SHA256.
 * Uses a constant salt per RFC 5869 recommendation.
 */
export function deriveEncryptionKey(masterKey: Buffer): Buffer {
	return Buffer.from(hkdfSync("sha256", masterKey, HKDF_SALT, HKDF_INFO, 32));
}

/**
 * Compute a deterministic key identifier from key material.
 * Returns the first 8 hex characters of SHA-256 of the derived key.
 */
export function computeKeyId(masterKey: Buffer): string {
	const derived = deriveEncryptionKey(masterKey);
	return createHash("sha256").update(derived).digest("hex").slice(0, 8);
}

/**
 * Encrypt a plaintext credential string using AES-256-GCM.
 * Returns base64(iv || ciphertext || authTag).
 * A fresh random IV is generated for every call.
 */
export function encryptCredential(plaintext: string, masterKey: Buffer): string {
	const key = deriveEncryptionKey(masterKey);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();

	return Buffer.concat([iv, encrypted, authTag]).toString("base64");
}

/**
 * Decrypt a credential encrypted with encryptCredential.
 * Expects base64(iv || ciphertext || authTag).
 * Throws on tampered data or wrong key.
 */
export function decryptCredential(encrypted: string, masterKey: Buffer): string {
	const key = deriveEncryptionKey(masterKey);
	const data = Buffer.from(encrypted, "base64");

	const iv = data.subarray(0, IV_LENGTH);
	const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
	const ciphertext = data.subarray(IV_LENGTH, data.length - AUTH_TAG_LENGTH);

	const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
	decipher.setAuthTag(authTag);

	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Try decrypting with the current key; if it fails and a previous key is
 * provided, try the previous key. Returns the plaintext and whether
 * re-encryption with the current key is needed.
 */
export function tryDecryptWithRotation(
	encrypted: string,
	currentKey: Buffer,
	previousKey: Buffer | null,
): { plaintext: string; needsReEncrypt: boolean } {
	try {
		const plaintext = decryptCredential(encrypted, currentKey);
		return { plaintext, needsReEncrypt: false };
	} catch {
		if (previousKey) {
			const plaintext = decryptCredential(encrypted, previousKey);
			return { plaintext, needsReEncrypt: true };
		}
		throw new Error("Failed to decrypt credential: neither current nor previous key succeeded");
	}
}
