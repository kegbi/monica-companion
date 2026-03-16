import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { z } from "zod/v4";

const configSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3007),
	DATABASE_URL: z.string().min(1),
	SETUP_TOKEN_SECRET: z.string().min(32),
	SETUP_BASE_URL: z.string().min(1),
	SETUP_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
	ENCRYPTION_MASTER_KEY: z.string().min(32),
	ENCRYPTION_MASTER_KEY_PREVIOUS: z.string().min(32).optional(),
});

/**
 * Parse a key string (hex or base64url) into a 32-byte Buffer.
 * Tries hex first (64 hex chars = 32 bytes), then base64url.
 */
function parseKeyToBuffer(keyString: string): Buffer {
	// Try hex: exactly 64 hex chars = 32 bytes
	if (/^[0-9a-fA-F]{64}$/.test(keyString)) {
		return Buffer.from(keyString, "hex");
	}
	// Try base64url
	const buf = Buffer.from(keyString, "base64url");
	if (buf.length >= 32) {
		return buf.subarray(0, 32);
	}
	// Try base64
	const buf64 = Buffer.from(keyString, "base64");
	if (buf64.length >= 32) {
		return buf64.subarray(0, 32);
	}
	throw new Error("ENCRYPTION_MASTER_KEY must decode to at least 32 bytes (hex or base64url)");
}

export interface Config {
	port: number;
	databaseUrl: string;
	setupTokenSecret: string;
	setupBaseUrl: string;
	setupTokenTtlMinutes: number;
	auth: AuthConfig;
	encryptionMasterKey: Buffer;
	encryptionMasterKeyPrevious: Buffer | null;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const parsed = configSchema.parse(env);
	const auth = loadAuthConfig(env);
	return {
		port: parsed.PORT,
		databaseUrl: parsed.DATABASE_URL,
		setupTokenSecret: parsed.SETUP_TOKEN_SECRET,
		setupBaseUrl: parsed.SETUP_BASE_URL,
		setupTokenTtlMinutes: parsed.SETUP_TOKEN_TTL_MINUTES,
		auth,
		encryptionMasterKey: parseKeyToBuffer(parsed.ENCRYPTION_MASTER_KEY),
		encryptionMasterKeyPrevious: parsed.ENCRYPTION_MASTER_KEY_PREVIOUS
			? parseKeyToBuffer(parsed.ENCRYPTION_MASTER_KEY_PREVIOUS)
			: null,
	};
}
