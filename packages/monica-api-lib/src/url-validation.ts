import dns from "node:dns";
import { isIP, isIPv4, isIPv6 } from "node:net";

/** Error codes for Monica URL validation failures. */
export type MonicaUrlValidationErrorCode =
	| "INVALID_URL"
	| "USERINFO_NOT_ALLOWED"
	| "FRAGMENT_NOT_ALLOWED"
	| "HTTP_NOT_ALLOWED"
	| "BLOCKED_IP"
	| "DNS_RESOLUTION_FAILED";

/** Typed error thrown when a Monica base URL fails validation. */
export class MonicaUrlValidationError extends Error {
	readonly code: MonicaUrlValidationErrorCode;

	constructor(code: MonicaUrlValidationErrorCode, message: string) {
		super(message);
		this.name = "MonicaUrlValidationError";
		this.code = code;
	}
}

/**
 * Normalize a raw Monica base URL into canonical form.
 *
 * Rules:
 * 1. Parse with URL constructor. Reject on failure.
 * 2. Reject URLs with userinfo (username/password).
 * 3. Reject URLs with fragment (hash).
 * 4. Scheme must be http: or https:.
 * 5. Lowercase scheme and hostname (URL constructor does this).
 * 6. Strip default ports (:443 for https, :80 for http).
 * 7. Normalize pathname: remove trailing slashes, ensure /api suffix.
 * 8. Reconstruct canonical URL.
 */
export function normalizeMonicaUrl(rawUrl: string): string {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new MonicaUrlValidationError("INVALID_URL", "URL is malformed");
	}

	if (parsed.username || parsed.password) {
		throw new MonicaUrlValidationError(
			"USERINFO_NOT_ALLOWED",
			"URLs with userinfo (user:pass@) are not allowed",
		);
	}

	if (parsed.hash) {
		throw new MonicaUrlValidationError(
			"FRAGMENT_NOT_ALLOWED",
			"URLs with fragments (#) are not allowed",
		);
	}

	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new MonicaUrlValidationError(
			"INVALID_URL",
			"Only http: and https: schemes are supported",
		);
	}

	// URL constructor already lowercases scheme and hostname.
	// Strip default ports. Use parsed.hostname (which includes brackets for IPv6).
	let host = parsed.hostname;
	if (parsed.port) {
		const isDefaultPort =
			(parsed.protocol === "https:" && parsed.port === "443") ||
			(parsed.protocol === "http:" && parsed.port === "80");
		if (!isDefaultPort) {
			host = `${host}:${parsed.port}`;
		}
	}

	// Normalize pathname: remove trailing slashes, ensure /api suffix.
	// Pathname case is preserved by the URL constructor, so compare lowercase.
	let pathname = parsed.pathname.replace(/\/+$/, "");
	if (!pathname.toLowerCase().endsWith("/api")) {
		pathname = `${pathname}/api`;
	} else {
		// Normalize the /api suffix to lowercase
		pathname = `${pathname.slice(0, -4)}/api`;
	}

	return `${parsed.protocol}//${host}${pathname}`;
}

// ── IP Range Checking ────────────────────────────────────────────────

/** Check if an IPv4 address string is in a blocked range. */
function isBlockedIpv4(ip: string): boolean {
	const parts = ip.split(".").map(Number);
	if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) {
		return false;
	}

	const [a, b] = parts;

	// Unspecified: 0.0.0.0
	if (parts.every((p) => p === 0)) return true;

	// Loopback: 127.0.0.0/8
	if (a === 127) return true;

	// RFC1918 Class A: 10.0.0.0/8
	if (a === 10) return true;

	// RFC1918 Class B: 172.16.0.0/12
	if (a === 172 && b >= 16 && b <= 31) return true;

	// RFC1918 Class C: 192.168.0.0/16
	if (a === 192 && b === 168) return true;

	// Link-local: 169.254.0.0/16
	if (a === 169 && b === 254) return true;

	return false;
}

/** Check if an IPv6 address string is in a blocked range. */
function isBlockedIpv6(ip: string): boolean {
	const lower = ip.toLowerCase();

	// Unspecified: ::
	if (lower === "::") return true;

	// Loopback: ::1
	if (lower === "::1") return true;

	// Link-local: fe80::/10
	if (
		lower.startsWith("fe80:") ||
		lower.startsWith("fe8") ||
		lower.startsWith("fe9") ||
		lower.startsWith("fea") ||
		lower.startsWith("feb")
	) {
		// More precise: check first 10 bits = 1111111010
		// fe80-febf are all in fe80::/10
		const prefix = lower.slice(0, 4);
		if (prefix >= "fe80" && prefix <= "febf") return true;
	}

	// IPv4-mapped IPv6: ::ffff:x.x.x.x
	const v4MappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (v4MappedMatch) {
		return isBlockedIpv4(v4MappedMatch[1]);
	}

	return false;
}

/** Check if an IP address (v4 or v6) is in a blocked range. */
export function isBlockedIp(ip: string): boolean {
	if (isIPv4(ip)) return isBlockedIpv4(ip);
	if (isIPv6(ip)) return isBlockedIpv6(ip);
	return false;
}

// ── Async URL Validation ─────────────────────────────────────────────

/** DNS lookup function signature compatible with dns.promises.lookup. */
export type DnsLookupFn = (
	hostname: string,
	options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

/** Options for async URL validation. */
export interface ValidateMonicaUrlOptions {
	/** When true, allows http:// and private network IP targets. */
	allowPrivateNetworkTargets: boolean;
	/** Injectable DNS lookup for testing. Defaults to dns.promises.lookup. */
	dnsLookup?: DnsLookupFn;
}

/**
 * Validate a normalized Monica URL by checking scheme rules and
 * resolving the hostname to check all IP addresses against blocked ranges.
 *
 * Must be called with a URL that has already been through normalizeMonicaUrl.
 */
export async function validateMonicaUrl(
	normalizedUrl: string,
	options: ValidateMonicaUrlOptions,
): Promise<void> {
	const parsed = new URL(normalizedUrl);
	const { allowPrivateNetworkTargets } = options;

	// Check scheme: reject http:// unless override is enabled
	if (parsed.protocol === "http:" && !allowPrivateNetworkTargets) {
		throw new MonicaUrlValidationError(
			"HTTP_NOT_ALLOWED",
			"Only HTTPS URLs are allowed in hosted mode",
		);
	}

	// URL constructor wraps IPv6 literals in brackets; strip them for IP checks.
	const rawHostname = parsed.hostname;
	const hostname =
		rawHostname.startsWith("[") && rawHostname.endsWith("]")
			? rawHostname.slice(1, -1)
			: rawHostname;

	// Check if hostname is an IP literal
	const ipVersion = isIP(hostname);
	if (ipVersion > 0) {
		// IP literal: check directly, no DNS needed
		if (!allowPrivateNetworkTargets && isBlockedIp(hostname)) {
			throw new MonicaUrlValidationError("BLOCKED_IP", "URL resolves to a blocked IP address");
		}
		return;
	}

	// Hostname is a domain name: resolve via DNS
	const lookup = options.dnsLookup ?? (dns.promises.lookup as DnsLookupFn);

	let addresses: Array<{ address: string; family: number }>;
	try {
		addresses = await lookup(hostname, { all: true });
	} catch {
		throw new MonicaUrlValidationError(
			"DNS_RESOLUTION_FAILED",
			"Failed to resolve hostname via DNS",
		);
	}

	if (!allowPrivateNetworkTargets) {
		for (const { address } of addresses) {
			if (isBlockedIp(address)) {
				throw new MonicaUrlValidationError("BLOCKED_IP", "URL resolves to a blocked IP address");
			}
		}
	}
}
