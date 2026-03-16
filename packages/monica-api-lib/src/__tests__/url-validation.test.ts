import { describe, expect, it, vi } from "vitest";
import {
	isBlockedIp,
	MonicaUrlValidationError,
	normalizeMonicaUrl,
	validateMonicaUrl,
} from "../url-validation.js";

describe("normalizeMonicaUrl", () => {
	it("appends /api to base URL without path", () => {
		expect(normalizeMonicaUrl("https://app.monicahq.com")).toBe("https://app.monicahq.com/api");
	});

	it("appends /api to base URL with trailing slash", () => {
		expect(normalizeMonicaUrl("https://app.monicahq.com/")).toBe("https://app.monicahq.com/api");
	});

	it("preserves existing /api suffix", () => {
		expect(normalizeMonicaUrl("https://app.monicahq.com/api")).toBe("https://app.monicahq.com/api");
	});

	it("strips trailing slash from /api/", () => {
		expect(normalizeMonicaUrl("https://app.monicahq.com/api/")).toBe(
			"https://app.monicahq.com/api",
		);
	});

	it("lowercases scheme and host", () => {
		expect(normalizeMonicaUrl("HTTPS://APP.MONICAHQ.COM/API")).toBe("https://app.monicahq.com/api");
	});

	it("strips default HTTPS port 443", () => {
		expect(normalizeMonicaUrl("https://app.monicahq.com:443/api")).toBe(
			"https://app.monicahq.com/api",
		);
	});

	it("preserves non-default port", () => {
		expect(normalizeMonicaUrl("https://monica.example.com:8443/api")).toBe(
			"https://monica.example.com:8443/api",
		);
	});

	it("appends /api after subpath", () => {
		expect(normalizeMonicaUrl("https://example.com/monica")).toBe("https://example.com/monica/api");
	});

	it("strips default HTTP port 80", () => {
		expect(normalizeMonicaUrl("http://example.com:80/api")).toBe("http://example.com/api");
	});

	it("normalizes IPv4 literal hostname", () => {
		expect(normalizeMonicaUrl("https://192.0.2.1:443/api")).toBe("https://192.0.2.1/api");
	});

	it("normalizes IPv6 literal hostname", () => {
		expect(normalizeMonicaUrl("https://[2001:db8::1]/api")).toBe("https://[2001:db8::1]/api");
	});

	it("throws USERINFO_NOT_ALLOWED for URLs with user:pass", () => {
		expect(() => normalizeMonicaUrl("https://user:pass@example.com")).toThrow(
			MonicaUrlValidationError,
		);
		try {
			normalizeMonicaUrl("https://user:pass@example.com");
		} catch (err) {
			expect((err as MonicaUrlValidationError).code).toBe("USERINFO_NOT_ALLOWED");
		}
	});

	it("throws FRAGMENT_NOT_ALLOWED for URLs with hash", () => {
		expect(() => normalizeMonicaUrl("https://example.com/api#frag")).toThrow(
			MonicaUrlValidationError,
		);
		try {
			normalizeMonicaUrl("https://example.com/api#frag");
		} catch (err) {
			expect((err as MonicaUrlValidationError).code).toBe("FRAGMENT_NOT_ALLOWED");
		}
	});

	it("throws INVALID_URL for malformed URLs", () => {
		expect(() => normalizeMonicaUrl("not-a-url")).toThrow(MonicaUrlValidationError);
		try {
			normalizeMonicaUrl("not-a-url");
		} catch (err) {
			expect((err as MonicaUrlValidationError).code).toBe("INVALID_URL");
		}
	});

	it("throws INVALID_URL for non-HTTP schemes", () => {
		expect(() => normalizeMonicaUrl("ftp://example.com")).toThrow(MonicaUrlValidationError);
		try {
			normalizeMonicaUrl("ftp://example.com");
		} catch (err) {
			expect((err as MonicaUrlValidationError).code).toBe("INVALID_URL");
		}
	});
});

describe("isBlockedIp", () => {
	describe("IPv4", () => {
		it("blocks loopback 127.0.0.1", () => {
			expect(isBlockedIp("127.0.0.1")).toBe(true);
		});

		it("blocks loopback 127.255.255.255", () => {
			expect(isBlockedIp("127.255.255.255")).toBe(true);
		});

		it("blocks RFC1918 10.x.x.x", () => {
			expect(isBlockedIp("10.0.0.1")).toBe(true);
		});

		it("blocks RFC1918 172.16.x.x", () => {
			expect(isBlockedIp("172.16.0.1")).toBe(true);
		});

		it("blocks RFC1918 172.31.x.x", () => {
			expect(isBlockedIp("172.31.255.255")).toBe(true);
		});

		it("does not block 172.15.x.x", () => {
			expect(isBlockedIp("172.15.0.1")).toBe(false);
		});

		it("does not block 172.32.x.x", () => {
			expect(isBlockedIp("172.32.0.1")).toBe(false);
		});

		it("blocks RFC1918 192.168.x.x", () => {
			expect(isBlockedIp("192.168.0.1")).toBe(true);
		});

		it("blocks link-local 169.254.x.x", () => {
			expect(isBlockedIp("169.254.1.1")).toBe(true);
		});

		it("blocks unspecified 0.0.0.0", () => {
			expect(isBlockedIp("0.0.0.0")).toBe(true);
		});

		it("allows public IP 8.8.8.8", () => {
			expect(isBlockedIp("8.8.8.8")).toBe(false);
		});

		it("allows public IP 203.0.113.1", () => {
			expect(isBlockedIp("203.0.113.1")).toBe(false);
		});
	});

	describe("IPv6", () => {
		it("blocks loopback ::1", () => {
			expect(isBlockedIp("::1")).toBe(true);
		});

		it("blocks link-local fe80::1", () => {
			expect(isBlockedIp("fe80::1")).toBe(true);
		});

		it("blocks link-local fe80::abcd:1234", () => {
			expect(isBlockedIp("fe80::abcd:1234")).toBe(true);
		});

		it("blocks unspecified ::", () => {
			expect(isBlockedIp("::")).toBe(true);
		});

		it("blocks IPv4-mapped ::ffff:127.0.0.1", () => {
			expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
		});

		it("blocks IPv4-mapped ::ffff:10.0.0.1", () => {
			expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
		});

		it("blocks IPv4-mapped ::ffff:192.168.1.1", () => {
			expect(isBlockedIp("::ffff:192.168.1.1")).toBe(true);
		});

		it("allows public IPv6 2607:f8b0:4004:800::200e", () => {
			expect(isBlockedIp("2607:f8b0:4004:800::200e")).toBe(false);
		});

		it("allows IPv4-mapped public ::ffff:8.8.8.8", () => {
			expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
		});
	});
});

describe("validateMonicaUrl", () => {
	const publicDnsLookup = vi.fn().mockResolvedValue([{ address: "203.0.113.50", family: 4 }]);

	it("passes for valid public HTTPS URL", async () => {
		await expect(
			validateMonicaUrl("https://app.monicahq.com/api", {
				allowPrivateNetworkTargets: false,
				dnsLookup: publicDnsLookup,
			}),
		).resolves.toBeUndefined();
	});

	it("throws HTTP_NOT_ALLOWED for http:// without override", async () => {
		try {
			await validateMonicaUrl("http://monica.local/api", {
				allowPrivateNetworkTargets: false,
				dnsLookup: publicDnsLookup,
			});
			expect.fail("Expected error");
		} catch (err) {
			expect(err).toBeInstanceOf(MonicaUrlValidationError);
			expect((err as MonicaUrlValidationError).code).toBe("HTTP_NOT_ALLOWED");
		}
	});

	it("allows http:// with override enabled", async () => {
		await expect(
			validateMonicaUrl("http://monica.local/api", {
				allowPrivateNetworkTargets: true,
				dnsLookup: publicDnsLookup,
			}),
		).resolves.toBeUndefined();
	});

	it("throws BLOCKED_IP when DNS resolves to loopback", async () => {
		const loopbackLookup = vi.fn().mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

		try {
			await validateMonicaUrl("https://evil.example.com/api", {
				allowPrivateNetworkTargets: false,
				dnsLookup: loopbackLookup,
			});
			expect.fail("Expected error");
		} catch (err) {
			expect(err).toBeInstanceOf(MonicaUrlValidationError);
			expect((err as MonicaUrlValidationError).code).toBe("BLOCKED_IP");
		}
	});

	it("allows blocked IP with override enabled", async () => {
		const loopbackLookup = vi.fn().mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

		await expect(
			validateMonicaUrl("https://monica.local/api", {
				allowPrivateNetworkTargets: true,
				dnsLookup: loopbackLookup,
			}),
		).resolves.toBeUndefined();
	});

	it("throws DNS_RESOLUTION_FAILED on DNS error", async () => {
		const failingLookup = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));

		try {
			await validateMonicaUrl("https://nonexistent.example.com/api", {
				allowPrivateNetworkTargets: false,
				dnsLookup: failingLookup,
			});
			expect.fail("Expected error");
		} catch (err) {
			expect(err).toBeInstanceOf(MonicaUrlValidationError);
			expect((err as MonicaUrlValidationError).code).toBe("DNS_RESOLUTION_FAILED");
		}
	});

	it("throws BLOCKED_IP when any resolved address is blocked", async () => {
		const mixedLookup = vi.fn().mockResolvedValue([
			{ address: "203.0.113.50", family: 4 },
			{ address: "127.0.0.1", family: 4 },
		]);

		try {
			await validateMonicaUrl("https://multi.example.com/api", {
				allowPrivateNetworkTargets: false,
				dnsLookup: mixedLookup,
			});
			expect.fail("Expected error");
		} catch (err) {
			expect(err).toBeInstanceOf(MonicaUrlValidationError);
			expect((err as MonicaUrlValidationError).code).toBe("BLOCKED_IP");
		}
	});

	it("checks IP literal hostnames directly without DNS", async () => {
		const dnsLookup = vi.fn();

		try {
			await validateMonicaUrl("https://127.0.0.1/api", {
				allowPrivateNetworkTargets: false,
				dnsLookup,
			});
			expect.fail("Expected error");
		} catch (err) {
			expect(err).toBeInstanceOf(MonicaUrlValidationError);
			expect((err as MonicaUrlValidationError).code).toBe("BLOCKED_IP");
		}

		// DNS should not be called for IP literals
		expect(dnsLookup).not.toHaveBeenCalled();
	});

	it("checks IPv6 literal hostnames directly without DNS", async () => {
		const dnsLookup = vi.fn();

		try {
			await validateMonicaUrl("https://[::1]/api", {
				allowPrivateNetworkTargets: false,
				dnsLookup,
			});
			expect.fail("Expected error");
		} catch (err) {
			expect(err).toBeInstanceOf(MonicaUrlValidationError);
			expect((err as MonicaUrlValidationError).code).toBe("BLOCKED_IP");
		}

		expect(dnsLookup).not.toHaveBeenCalled();
	});

	it("allows public IP literal", async () => {
		const dnsLookup = vi.fn();

		await expect(
			validateMonicaUrl("https://203.0.113.50/api", {
				allowPrivateNetworkTargets: false,
				dnsLookup,
			}),
		).resolves.toBeUndefined();

		expect(dnsLookup).not.toHaveBeenCalled();
	});
});
