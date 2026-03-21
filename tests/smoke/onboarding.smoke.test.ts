/**
 * Onboarding form smoke tests.
 *
 * Verifies the web-ui onboarding flow end-to-end through the live
 * Docker Compose stack: setup pages, form submission, and the full
 * token issue -> form load -> submit -> success redirect flow.
 *
 * Tests both direct web-ui access and Caddy reverse proxy paths.
 */

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { authedRequest, smokeRequest } from "./helpers.js";
import { loadSmokeConfig } from "./smoke-config.js";

const config = loadSmokeConfig();
const DL = String.fromCharCode(36);

/**
 * Helper: GET a page and extract the CSRF cookie + token from the response.
 * Returns { csrfCookie, csrfToken } for use in subsequent POST requests.
 */
async function getCsrfFromPage(
	pageUrl: string,
): Promise<{ csrfCookie: string; csrfToken: string; html: string }> {
	const res = await fetch(pageUrl, {
		signal: AbortSignal.timeout(15_000),
	});
	const html = await res.text();

	// Extract Set-Cookie header to get the CSRF cookie
	const setCookie = res.headers.get("set-cookie") ?? "";
	// Cookie format: csrf=<token>; HttpOnly; SameSite=Strict; Path=/setup
	const cookieMatch = setCookie.match(/(?:csrf|__Host-csrf)=([^;]+)/);
	const csrfToken = cookieMatch ? cookieMatch[1] : "";

	// Build the cookie header to send back
	const csrfCookieName = setCookie.includes("__Host-csrf") ? "__Host-csrf" : "csrf";
	const csrfCookie = csrfToken ? csrfCookieName + "=" + csrfToken : "";

	return { csrfCookie, csrfToken, html };
}

// ---------------------------------------------------------------------------
// 1. Static pages through Caddy (reverse proxy path)
// ---------------------------------------------------------------------------
describe("onboarding pages via Caddy", async () => {
	let caddyAvailable = false;
	try {
		await smokeRequest(config.CADDY_URL + "/", { timeout: 2000 });
		caddyAvailable = true;
	} catch {
		// Caddy not running
	}
	if (!caddyAvailable) {
		it.skip("caddy not available -- skipping onboarding proxy tests", () => {});
		return;
	}

	it("GET /setup/success returns 200 with completion message", async () => {
		const res = await fetch(config.CADDY_URL + "/setup/success", {
			signal: AbortSignal.timeout(10_000),
		});
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Setup Complete");
		expect(html).toContain("Return to Telegram");
	});

	it("GET /setup/error?reason=expired returns 200 with expired message", async () => {
		const res = await fetch(config.CADDY_URL + "/setup/error?reason=expired", {
			signal: AbortSignal.timeout(10_000),
		});
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Setup Error");
		expect(html).toContain("expired");
	});

	it("GET /setup/error?reason=already_consumed returns appropriate message", async () => {
		const res = await fetch(config.CADDY_URL + "/setup/error?reason=already_consumed", {
			signal: AbortSignal.timeout(10_000),
		});
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("already been used");
	});

	it("GET /setup/error with unknown reason does not render raw param (XSS safety)", async () => {
		const xssPayload = "<script>alert(1)</script>";
		const res = await fetch(
			config.CADDY_URL + "/setup/error?reason=" + encodeURIComponent(xssPayload),
			{ signal: AbortSignal.timeout(10_000) },
		);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).not.toContain(xssPayload);
		expect(html).toContain("Something went wrong");
	});

	it("Caddy sets security headers on /setup routes", async () => {
		const res = await fetch(config.CADDY_URL + "/setup/success", {
			signal: AbortSignal.timeout(10_000),
		});
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("x-frame-options")).toBe("DENY");
		expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
	});

	it("Caddy strips Server header on /setup routes", async () => {
		const res = await fetch(config.CADDY_URL + "/setup/success", {
			signal: AbortSignal.timeout(10_000),
		});
		expect(res.headers.get("server")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 2. Static pages direct to web-ui (bypassing Caddy)
// ---------------------------------------------------------------------------
describe("onboarding pages direct to web-ui", () => {
	it("GET /setup/success returns 200 with completion HTML", async () => {
		const res = await fetch(config.WEB_UI_URL + "/setup/success", {
			signal: AbortSignal.timeout(10_000),
		});
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Setup Complete");
		expect(html).toContain("Return to Telegram");
		expect(html).toContain("Monica Companion");
	});

	it("GET /setup/error?reason=validation_failed returns error page", async () => {
		const res = await fetch(config.WEB_UI_URL + "/setup/error?reason=validation_failed", {
			signal: AbortSignal.timeout(10_000),
		});
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Setup Error");
		expect(html).toContain("could not be validated");
	});

	it("GET /setup/error without reason param shows generic message", async () => {
		const res = await fetch(config.WEB_UI_URL + "/setup/error", {
			signal: AbortSignal.timeout(10_000),
		});
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Something went wrong");
	});
});

// ---------------------------------------------------------------------------
// 3. End-to-end onboarding flow: issue token -> load form -> submit -> success
//    Uses Caddy URL when available, falls back to direct web-ui URL.
// ---------------------------------------------------------------------------
let formBaseUrl = config.WEB_UI_URL;
try {
	const probe = await fetch(config.CADDY_URL + "/setup/success", {
		signal: AbortSignal.timeout(2000),
	});
	if (probe.ok) formBaseUrl = config.CADDY_URL;
} catch {
	// Caddy not available — use direct web-ui URL
}
// Origin header must match what the web-ui middleware expects
const formOrigin = new URL(formBaseUrl).origin;

describe("end-to-end onboarding flow", () => {
	const sql = postgres(config.POSTGRES_URL, { max: 1 });
	let tokenId: string;
	let setupUrl: string;
	let sig: string;

	afterAll(async () => {
		if (tokenId) {
			try {
				await sql.unsafe(
					"DELETE FROM user_preferences WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id LIKE " +
						DL +
						"1)",
					["smoke-onboard-%"],
				);
				await sql.unsafe(
					"DELETE FROM credential_access_audit_log WHERE user_id IN (SELECT id FROM users WHERE telegram_user_id LIKE " +
						DL +
						"1)",
					["smoke-onboard-%"],
				);
				await sql.unsafe("DELETE FROM users WHERE telegram_user_id LIKE " + DL + "1", [
					"smoke-onboard-%",
				]);
				await sql.unsafe("DELETE FROM setup_token_audit_log WHERE token_id = " + DL + "1", [
					tokenId,
				]);
				await sql.unsafe("DELETE FROM setup_tokens WHERE id = " + DL + "1", [tokenId]);
			} catch {
				// best-effort cleanup
			}
		}
		await sql.end();
	});

	it("step 1: issue a setup token via user-management", async () => {
		const telegramUserId = "smoke-onboard-" + Date.now().toString();
		const { status, body } = await authedRequest(
			config.USER_MANAGEMENT_URL + "/internal/setup-tokens",
			"user-management",
			{
				method: "POST",
				issuer: "telegram-bridge",
				body: {
					telegramUserId,
					step: "onboarding",
				},
			},
		);
		expect(status).toBe(201);
		const data = body as { setupUrl: string; tokenId: string; expiresAt: string };
		expect(data).toHaveProperty("setupUrl");
		expect(data).toHaveProperty("tokenId");
		expect(data).toHaveProperty("expiresAt");

		tokenId = data.tokenId;
		setupUrl = data.setupUrl;
		const url = new URL(setupUrl);
		sig = url.searchParams.get("sig") ?? "";
		expect(sig.length).toBeGreaterThan(0);
	});

	it("step 2: form page loads with all expected fields and sets CSRF cookie", async () => {
		const { csrfCookie, csrfToken, html } = await getCsrfFromPage(
			formBaseUrl + "/setup/" + tokenId + "?sig=" + encodeURIComponent(sig),
		);

		expect(html).toContain("monicaBaseUrl");
		expect(html).toContain("monicaApiKey");
		expect(html).toContain("language");
		expect(html).toContain("confirmationMode");
		expect(html).toContain("timezone");
		expect(html).toContain("reminderCadence");
		expect(html).toContain("reminderTime");
		expect(html).toContain("/setup/submit");
		expect(html).toContain("Monica Companion");
		// Verify CSRF token was issued
		expect(csrfToken.length).toBeGreaterThan(0);
		expect(csrfCookie.length).toBeGreaterThan(0);
	});

	it("step 3: form submission with CSRF creates user and redirects to success", async () => {
		const { csrfCookie, csrfToken } = await getCsrfFromPage(
			formBaseUrl + "/setup/" + tokenId + "?sig=" + encodeURIComponent(sig),
		);

		const formData = new URLSearchParams({
			tokenId,
			sig,
			csrf_token: csrfToken,
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "test-api-key-smoke-onboarding",
			language: "en",
			confirmationMode: "explicit",
			timezone: "America/New_York",
			reminderCadence: "daily",
			reminderTime: "08:00",
		});

		const res = await fetch(formBaseUrl + "/setup/submit", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				origin: "http://localhost",
				cookie: csrfCookie,
			},
			body: formData.toString(),
			redirect: "manual",
			signal: AbortSignal.timeout(15_000),
		});

		expect(res.status).toBe(303);
		const location = res.headers.get("location");
		expect(location).toContain("/setup/success");
	});

	it("step 4: user record was created in the database", async () => {
		const users = await sql.unsafe(
			"SELECT u.id, u.telegram_user_id, u.monica_base_url, u.encryption_key_id FROM users u WHERE u.telegram_user_id LIKE " +
				DL +
				"1",
			["smoke-onboard-%"],
		);
		expect(users.length).toBeGreaterThanOrEqual(1);
		const user = users[0];
		expect(user.monica_base_url).toContain("monicahq.com");
		expect(user.encryption_key_id).toBeTruthy();

		const prefs = await sql.unsafe(
			"SELECT language, confirmation_mode, timezone, reminder_cadence, reminder_time FROM user_preferences WHERE user_id = " +
				DL +
				"1",
			[user.id],
		);
		expect(prefs.length).toBe(1);
		expect(prefs[0].language).toBe("en");
		expect(prefs[0].confirmation_mode).toBe("explicit");
		expect(prefs[0].timezone).toBe("America/New_York");
		expect(prefs[0].reminder_cadence).toBe("daily");
		expect(prefs[0].reminder_time).toBe("08:00");
	});

	it("step 5: replaying the same token fails (already consumed)", async () => {
		// Get a fresh CSRF token
		const { csrfCookie, csrfToken } = await getCsrfFromPage(formBaseUrl + "/setup/success");

		const formData = new URLSearchParams({
			tokenId,
			sig,
			csrf_token: csrfToken,
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "test-api-key-replay",
			language: "en",
			confirmationMode: "explicit",
			timezone: "America/New_York",
			reminderCadence: "daily",
			reminderTime: "08:00",
		});

		const res = await fetch(formBaseUrl + "/setup/submit", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				origin: "http://localhost",
				cookie: csrfCookie,
			},
			body: formData.toString(),
			redirect: "manual",
			signal: AbortSignal.timeout(15_000),
		});

		expect(res.status).toBe(303);
		const location = res.headers.get("location");
		expect(location).toContain("/setup/error");
	});
});

// ---------------------------------------------------------------------------
// 4. CSRF protection on form submission
// ---------------------------------------------------------------------------
describe("CSRF protection on form submission", () => {
	it("POST /setup/submit without Origin header returns 403", async () => {
		const { csrfCookie, csrfToken } = await getCsrfFromPage(formBaseUrl + "/setup/success");

		const res = await fetch(formBaseUrl + "/setup/submit", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				cookie: csrfCookie,
			},
			body: new URLSearchParams({ tokenId: "test", sig: "test", csrf_token: csrfToken }).toString(),
			redirect: "manual",
			signal: AbortSignal.timeout(10_000),
		});
		expect(res.status).toBe(403);
	});

	it("POST /setup/submit without CSRF cookie returns 403", async () => {
		const res = await fetch(formBaseUrl + "/setup/submit", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				origin: "http://localhost",
			},
			body: new URLSearchParams({ tokenId: "test", sig: "test", csrf_token: "fake" }).toString(),
			redirect: "manual",
			signal: AbortSignal.timeout(10_000),
		});
		expect(res.status).toBe(403);
	});
});
