import { type AuthConfig, loadAuthConfig } from "@monica-companion/auth";
import { z } from "zod/v4";

const configSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3007),
	DATABASE_URL: z.string().min(1),
	SETUP_TOKEN_SECRET: z.string().min(32),
	SETUP_BASE_URL: z.string().min(1),
	SETUP_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
	ENCRYPTION_MASTER_KEY: z.string().min(32),
	ENCRYPTION_MASTER_KEY_PREVIOUS: z
		.string()
		.transform((s) => (s === "" ? undefined : s))
		.pipe(z.string().min(32).optional()),
	AI_ROUTER_URL: z.string().min(1).default("http://ai-router:3002"),
	SCHEDULER_URL: z.string().min(1).default("http://scheduler:3005"),
	DELIVERY_URL: z.string().min(1).default("http://delivery:3006"),
	PURGE_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
	HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
	STALE_CLAIM_THRESHOLD_MINUTES: z.coerce.number().int().positive().default(30),
	MAX_PURGE_RETRIES: z.coerce.number().int().positive().default(5),
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
	aiRouterUrl: string;
	schedulerUrl: string;
	deliveryUrl: string;
	purgeSweepIntervalMs: number;
	httpTimeoutMs: number;
	staleClaimThresholdMinutes: number;
	maxPurgeRetries: number;
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
		aiRouterUrl: parsed.AI_ROUTER_URL,
		schedulerUrl: parsed.SCHEDULER_URL,
		deliveryUrl: parsed.DELIVERY_URL,
		purgeSweepIntervalMs: parsed.PURGE_SWEEP_INTERVAL_MS,
		httpTimeoutMs: parsed.HTTP_TIMEOUT_MS,
		staleClaimThresholdMinutes: parsed.STALE_CLAIM_THRESHOLD_MINUTES,
		maxPurgeRetries: parsed.MAX_PURGE_RETRIES,
	};
}
