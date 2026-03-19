/**
 * Seed script for the Monica smoke test instance.
 *
 * This script:
 * 1. Waits for Monica to become healthy (retries with backoff, 120s timeout)
 * 2. Registers a user via Monica's registration endpoint
 * 3. Creates a Personal Access Token via the OAuth API
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

import { execSync } from "node:child_process";
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

// ── Step 2: Register a user via artisan inside the container ──────────

const MONICA_CONTAINER = process.env.MONICA_SMOKE_CONTAINER || "monica-smoke";

function dockerExec(cmd: string): string {
	try {
		return execSync(`docker exec ${MONICA_CONTAINER} ${cmd}`, {
			encoding: "utf-8",
			timeout: 60_000,
		}).trim();
	} catch (err) {
		// biome-ignore lint/suspicious/noExplicitAny: execSync error has stderr property not in Error type
		const message = err instanceof Error ? (err as any).stderr || err.message : String(err);
		throw new Error(`docker exec failed: ${message}`);
	}
}

/**
 * Run a PHP script inside the Monica container via artisan tinker.
 * Uses base64 encoding piped through docker exec stdin to avoid
 * any shell quoting issues with PHP $variables.
 */
function dockerTinker(phpCode: string): string {
	const b64 = Buffer.from(phpCode).toString("base64");
	try {
		return execSync(
			`echo ${b64} | docker exec -i ${MONICA_CONTAINER} bash -c "base64 -d > /tmp/_tinker.php && php artisan tinker /tmp/_tinker.php"`,
			{ encoding: "utf-8", timeout: 60_000 },
		).trim();
	} catch (err) {
		// biome-ignore lint/suspicious/noExplicitAny: execSync error has stderr property not in Error type
		const message = err instanceof Error ? (err as any).stderr || err.message : String(err);
		throw new Error(`dockerTinker failed: ${message}`);
	}
}

async function registerUser(): Promise<void> {
	console.log("Registering test user via artisan...");

	try {
		const phpCode = `<?php
$user = new \\App\\Models\\User\\User;
$user->first_name = '${TEST_USER.first_name}';
$user->last_name = '${TEST_USER.last_name}';
$user->email = '${TEST_USER.email}';
$user->password = bcrypt('${TEST_USER.password}');
$user->locale = 'en';
$user->save();
$account = \\App\\Models\\Account\\Account::create([]);
$user->account_id = $account->id;
$user->save();
echo 'USER_ID=' . $user->id;
`;
		const output = dockerTinker(phpCode);
		console.log(`  ${output}`);
		console.log("  User registered successfully");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes("Duplicate") || message.includes("UNIQUE")) {
			console.log("  User may already exist, proceeding...");
		} else {
			fatal("Failed to register user via artisan", err);
		}
	}
}

// ── Step 3: Get an API token via artisan ──────────────────────────────

async function getApiToken(): Promise<string> {
	console.log("Creating API token via artisan...");

	// First ensure Passport keys exist
	try {
		dockerExec("php artisan passport:keys --force");
		console.log("  Passport keys generated");
	} catch {
		console.log("  Passport keys may already exist, proceeding...");
	}

	// Create a Personal Access Client if none exists
	try {
		dockerExec('php artisan passport:client --personal --name="Smoke Test" --no-interaction');
		console.log("  Personal access client created");
	} catch {
		console.log("  Personal access client may already exist, proceeding...");
	}

	// Create a personal access token via tinker
	try {
		const phpCode = `<?php
$user = \\App\\Models\\User\\User::where('email', '${TEST_USER.email}')->firstOrFail();
$token = $user->createToken('smoke-test');
echo $token->accessToken;
`;
		const token = dockerTinker(phpCode);
		if (!token || token.length < 10) {
			fatal(`Got invalid token: ${token.slice(0, 20)}...`);
		}
		console.log(`  Got API token (${token.length} chars)`);
		return token;
	} catch (err) {
		fatal("Failed to create API token via artisan", err);
	}
}

// ── Step 4: Seed test data ─────────────────────────────────────────────

async function seedTestData(apiToken: string): Promise<void> {
	console.log("Seeding test data...");

	const headers = {
		Authorization: `Bearer ${apiToken}`,
	};

	// Get the first gender ID for creating contacts
	const gendersResult = (await fetchJson(`${MONICA_BASE_URL}/api/genders`, {
		headers,
	})) as { data: Array<{ id: number }> };

	if (!gendersResult.data || gendersResult.data.length === 0) {
		fatal("No genders found in Monica instance. Database may not be properly seeded.");
	}
	const genderId = gendersResult.data[0].id;

	// Contact 1: Full data (rich contact)
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

	// Contact 2: Minimal data
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

	// Contact 3: Partial data
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

	// Add note to full contact
	console.log("  Creating note on full contact...");
	await fetchJson(`${MONICA_BASE_URL}/api/notes`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			body: "This is a smoke test note for validating schema fidelity.",
			contact_id: fullContactId,
		}),
	});

	// Add activity to full contact
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

	// Add address to full contact
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

	// Add reminder to full contact
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

	// Update career info on full contact
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
