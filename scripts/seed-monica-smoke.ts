/**
 * Seed script for the Monica smoke test instance.
 *
 * This script:
 * 1. Waits for Monica to become healthy (retries with backoff, 300s timeout)
 * 2. Registers a user via Monica's web registration form
 * 3. Logs in and creates a Personal Access Token via Passport
 * 4. Seeds test contacts with varying data completeness
 * 5. Writes the API token and base URL to scripts/.env.smoke
 *
 * Usage:
 *   docker compose -f docker-compose.monica-smoke.yml up -d
 *   pnpm tsx scripts/seed-monica-smoke.ts
 *
 * Exit codes:
 *   0 - Success
 *   1 - Fatal error (see stderr for details)
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MONICA_BASE_URL = process.env.MONICA_SMOKE_URL || "http://localhost:8180";
const HEALTH_TIMEOUT_MS = 300_000;
const HEALTH_POLL_INTERVAL_MS = 3_000;

const TEST_USER = {
	email: "smoketest@example.test",
	password: "SmokeTest1234!",
	first_name: "Smoke",
	last_name: "Tester",
};

// ── Cookie Jar ────────────────────────────────────────────────────────

/** Simple cookie jar that collects Set-Cookie headers across requests. */
const cookieJar = new Map<string, string>();

function collectCookies(response: Response): void {
	const raw = response.headers.getSetCookie?.() ?? [];
	for (const header of raw) {
		// Extract "name=value" from "name=value; path=/; httponly; ..."
		const nameValue = header.split(";")[0].trim();
		const eqIdx = nameValue.indexOf("=");
		if (eqIdx > 0) {
			const name = nameValue.substring(0, eqIdx);
			cookieJar.set(name, nameValue);
		}
	}
}

function cookieHeader(): string {
	return [...cookieJar.values()].join("; ");
}

// ── Helpers ─────────────────────────────────────────────────────────────

function fatal(message: string, cause?: unknown): never {
	console.error(`[FATAL] ${message}`);
	if (cause instanceof Error) {
		console.error(`  Cause: ${cause.message}`);
	}
	process.exit(1);
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractCsrf(html: string): string | null {
	const m =
		html.match(/name="_token"\s+value="([^"]+)"/) ||
		html.match(/content="([^"]+)"\s+name="csrf-token"/) ||
		html.match(/name="csrf-token"\s+content="([^"]+)"/);
	return m ? m[1] : null;
}

async function fetchJson(
	url: string,
	options?: RequestInit & { expectStatus?: number },
): Promise<unknown> {
	const { expectStatus, ...fetchOpts } = options || {};
	const response = await fetch(url, {
		...fetchOpts,
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			...((fetchOpts?.headers as Record<string, string>) || {}),
		},
	});

	if (expectStatus !== undefined && response.status !== expectStatus) {
		const body = await response.text().catch(() => "(unreadable body)");
		throw new Error(
			`Expected HTTP ${expectStatus} from ${url}, got ${response.status}. Body: ${body.slice(0, 500)}`,
		);
	}

	if (!response.ok && expectStatus === undefined) {
		const body = await response.text().catch(() => "(unreadable body)");
		throw new Error(`HTTP ${response.status} from ${url}. Body: ${body.slice(0, 500)}`);
	}

	return response.json();
}

// ── Step 1: Wait for Monica to become healthy ──────────────────────────

async function waitForMonica(): Promise<void> {
	console.log(`Waiting for Monica at ${MONICA_BASE_URL} ...`);
	const deadline = Date.now() + HEALTH_TIMEOUT_MS;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(MONICA_BASE_URL, {
				signal: AbortSignal.timeout(5_000),
			});
			if (response.status < 500) {
				console.log(`Monica is responding (HTTP ${response.status})`);
				return;
			}
		} catch {
			// Not ready yet
		}

		const remaining = Math.round((deadline - Date.now()) / 1000);
		console.log(`  Not ready yet. ${remaining}s remaining...`);
		await sleep(HEALTH_POLL_INTERVAL_MS);
	}

	fatal(`Monica did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s`);
}

// ── Step 2: Register a user via the web registration form ─────────────

async function registerUser(): Promise<void> {
	console.log("Registering test user via web form...");

	try {
		// GET register page for CSRF token
		const pageResponse = await fetch(`${MONICA_BASE_URL}/register`, {
			redirect: "manual",
		});
		collectCookies(pageResponse);
		const pageHtml = await pageResponse.text();

		const csrfToken = extractCsrf(pageHtml);
		if (!csrfToken) {
			throw new Error("Could not find CSRF token in registration page");
		}

		// POST registration form
		const registerResponse = await fetch(`${MONICA_BASE_URL}/register`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Cookie: cookieHeader(),
			},
			body: new URLSearchParams({
				_token: csrfToken,
				email: TEST_USER.email,
				password: TEST_USER.password,
				password_confirmation: TEST_USER.password,
				first_name: TEST_USER.first_name,
				last_name: TEST_USER.last_name,
				policy: "on",
				lang: "en",
			}).toString(),
			redirect: "manual",
		});
		collectCookies(registerResponse);

		if (registerResponse.status === 302 || registerResponse.status === 200) {
			console.log(`  Registration succeeded (HTTP ${registerResponse.status})`);
		} else {
			const body = await registerResponse.text().catch(() => "");
			throw new Error(
				`Registration returned HTTP ${registerResponse.status}: ${body.slice(0, 200)}`,
			);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("422") || message.includes("already")) {
			console.log("  User may already exist, proceeding...");
		} else {
			fatal("Failed to register user", err);
		}
	}
}

// ── Step 3: Get an API token ──────────────────────────────────────────

async function getApiToken(): Promise<string> {
	console.log("Obtaining API token...");

	// Passport keys and personal access client are created by the Docker
	// entrypoint on first boot (see references/remote/docker/4/apache/entrypoint.sh).

	// Fresh login to get authenticated session
	console.log("  Logging in...");
	const loginPage = await fetch(`${MONICA_BASE_URL}/login`, { redirect: "manual" });
	collectCookies(loginPage);
	const loginHtml = await loginPage.text();
	const csrfToken = extractCsrf(loginHtml);
	if (!csrfToken) {
		fatal("Could not find CSRF token on login page");
	}

	const loginResponse = await fetch(`${MONICA_BASE_URL}/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Cookie: cookieHeader(),
		},
		body: new URLSearchParams({
			_token: csrfToken,
			email: TEST_USER.email,
			password: TEST_USER.password,
		}).toString(),
		redirect: "manual",
	});
	collectCookies(loginResponse);

	if (loginResponse.status !== 302) {
		fatal(`Login failed with HTTP ${loginResponse.status}`);
	}
	console.log("  Logged in successfully");

	// Use URL-decoded XSRF-TOKEN cookie as the CSRF token.
	// Monica v4 uses an SPA — there's no csrf-token meta tag in HTML.
	// Laravel expects the XSRF-TOKEN cookie value (URL-decoded) as the
	// X-XSRF-TOKEN header for AJAX requests.
	const xsrfCookie = cookieJar.get("XSRF-TOKEN");
	if (!xsrfCookie) {
		console.log(`  Cookie jar: ${[...cookieJar.keys()].join(", ")}`);
		fatal("No XSRF-TOKEN cookie found after login");
	}
	const xsrfValue = decodeURIComponent(xsrfCookie.split("=").slice(1).join("="));
	return await createToken(xsrfValue);
}

async function createToken(xsrfToken: string): Promise<string> {
	console.log("  Creating personal access token...");
	const tokenResponse = await fetch(`${MONICA_BASE_URL}/oauth/personal-access-tokens`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			Cookie: cookieHeader(),
			"X-XSRF-TOKEN": xsrfToken,
		},
		body: JSON.stringify({ name: "smoke-test", scopes: [] }),
	});
	collectCookies(tokenResponse);

	const body = await tokenResponse.text();
	if (!tokenResponse.ok) {
		fatal(`Token creation failed HTTP ${tokenResponse.status}: ${body.slice(0, 500)}`);
	}

	let result: { accessToken?: string };
	try {
		result = JSON.parse(body);
	} catch {
		fatal(`Token response not JSON (HTTP ${tokenResponse.status}): ${body.slice(0, 500)}`);
	}

	if (!result.accessToken) {
		fatal(`Token response missing accessToken: ${body.slice(0, 200)}`);
	}

	console.log(`  Got API token (${result.accessToken.length} chars)`);
	return result.accessToken;
}

// ── Step 4: Seed test data ─────────────────────────────────────────────

async function seedTestData(apiToken: string): Promise<void> {
	console.log("Seeding test data...");

	const headers = {
		Authorization: `Bearer ${apiToken}`,
	};

	const gendersResult = (await fetchJson(`${MONICA_BASE_URL}/api/genders`, {
		headers,
	})) as { data: Array<{ id: number }> };

	if (!gendersResult.data || gendersResult.data.length === 0) {
		fatal("No genders found in Monica instance. Database may not be properly seeded.");
	}
	const genderId = gendersResult.data[0].id;

	console.log("  Creating full contact...");
	const fullContact = (await fetchJson(`${MONICA_BASE_URL}/api/contacts`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			first_name: "FullSmoke",
			last_name: "TestContact",
			nickname: "Smoky",
			gender_id: genderId,
			is_birthdate_known: true,
			birthdate_day: 15,
			birthdate_month: 6,
			birthdate_year: 1990,
			is_deceased: false,
			is_deceased_date_known: false,
		}),
	})) as { data: { id: number } };
	const fullContactId = fullContact.data.id;
	console.log(`    Created contact ID: ${fullContactId}`);

	console.log("  Creating minimal contact...");
	const minimalContact = (await fetchJson(`${MONICA_BASE_URL}/api/contacts`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			first_name: "MinimalSmoke",
			gender_id: genderId,
			is_birthdate_known: false,
			is_deceased: false,
			is_deceased_date_known: false,
		}),
	})) as { data: { id: number } };
	console.log(`    Created contact ID: ${minimalContact.data.id}`);

	console.log("  Creating partial contact...");
	const partialContact = (await fetchJson(`${MONICA_BASE_URL}/api/contacts`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			first_name: "PartialSmoke",
			last_name: "Contact",
			gender_id: genderId,
			is_birthdate_known: false,
			is_deceased: false,
			is_deceased_date_known: false,
		}),
	})) as { data: { id: number } };
	console.log(`    Created contact ID: ${partialContact.data.id}`);

	console.log("  Creating note on full contact...");
	await fetchJson(`${MONICA_BASE_URL}/api/notes`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			body: "This is a smoke test note for validating schema fidelity.",
			contact_id: fullContactId,
		}),
	});

	console.log("  Creating activity on full contact...");
	await fetchJson(`${MONICA_BASE_URL}/api/activities`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			summary: "Smoke test lunch meeting",
			happened_at: "2026-03-15",
			contacts: [fullContactId],
		}),
	});

	console.log("  Creating address on full contact...");
	await fetchJson(`${MONICA_BASE_URL}/api/addresses`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			contact_id: fullContactId,
			name: "Home",
			street: "123 Smoke Test Lane",
			city: "TestCity",
			province: "TC",
			postal_code: "12345",
			country: "US",
		}),
	});

	console.log("  Creating reminder on full contact...");
	await fetchJson(`${MONICA_BASE_URL}/api/reminders`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			title: "Smoke test birthday reminder",
			initial_date: "2026-06-15",
			frequency_type: "year",
			frequency_number: 1,
			contact_id: fullContactId,
		}),
	});

	console.log("  Updating career info on full contact...");
	await fetchJson(`${MONICA_BASE_URL}/api/contacts/${fullContactId}/work`, {
		method: "PUT",
		headers,
		body: JSON.stringify({
			job: "QA Engineer",
			company: "Smoke Test Corp",
		}),
	});

	console.log("  Test data seeded successfully");
}

// ── Step 5: Write .env.smoke ───────────────────────────────────────────

function writeEnvFile(apiToken: string): void {
	const envPath = resolve(import.meta.dirname || process.cwd(), ".env.smoke");
	const content = [
		"# Generated by seed-monica-smoke.ts -- do not commit",
		`# Generated at: ${new Date().toISOString()}`,
		"",
		`MONICA_SMOKE_BASE_URL=${MONICA_BASE_URL}`,
		`MONICA_SMOKE_API_TOKEN=${apiToken}`,
		"",
	].join("\n");

	writeFileSync(envPath, content, "utf-8");
	console.log(`Smoke test config written to: ${envPath}`);
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log("=== Monica Smoke Test Seed Script ===");
	console.log(`Target: ${MONICA_BASE_URL}`);
	console.log("");

	await waitForMonica();
	await registerUser();
	const apiToken = await getApiToken();
	await seedTestData(apiToken);
	writeEnvFile(apiToken);

	console.log("");
	console.log("=== Seed complete. Run smoke tests with: ===");
	console.log("  pnpm test:smoke:monica");
}

main().catch((err) => {
	fatal("Unhandled error in seed script", err);
});
