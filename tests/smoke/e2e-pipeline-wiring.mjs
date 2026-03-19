/**
 * Smoke test: End-to-End Pipeline Wiring
 *
 * Verifies the actual network path between services after the
 * end-to-end pipeline wiring changes. Must run inside the Docker
 * network (e.g., from the ai-router container).
 *
 * Usage:
 *   docker exec monica-project-ai-router-1 node /app/tests/smoke/e2e-pipeline-wiring.mjs
 */

// jose is installed via pnpm — resolve from the pnpm store
import { createRequire } from "module";
import { randomUUID } from "crypto";
import { readdir } from "fs/promises";

// Find jose in the pnpm store dynamically
const pnpmBase = "/app/node_modules/.pnpm";
const joseDirs = (await readdir(pnpmBase)).filter((d) => d.startsWith("jose@"));
if (joseDirs.length === 0) throw new Error("jose not found in pnpm store");
const josePath = `${pnpmBase}/${joseDirs[0]}/node_modules/jose/dist/webapi/index.js`;
const { SignJWT } = await import(josePath);

const SECRET = new TextEncoder().encode("change-me-in-production");
const AI_ROUTER = "http://localhost:3002";
const DELIVERY = "http://delivery:3006";
const SCHEDULER = "http://scheduler:3005";
const USER_MGMT = "http://user-management:3007";
const TEST_USER = "00000000-0000-4000-8000-000000000001";

let passed = 0;
let failed = 0;

async function makeToken(iss = "telegram-bridge", aud = "ai-router", sub = TEST_USER) {
	const now = Math.floor(Date.now() / 1000);
	return new SignJWT({ cid: randomUUID() })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuer(iss)
		.setAudience(aud)
		.setJti(randomUUID())
		.setIssuedAt(now)
		.setExpirationTime(now + 120)
		.setSubject(sub)
		.sign(SECRET);
}

async function test(name, fn) {
	try {
		await fn();
		passed++;
		console.log(`  PASS: ${name}`);
	} catch (err) {
		failed++;
		console.error(`  FAIL: ${name} -- ${err.message}`);
	}
}

function assert(cond, msg) {
	if (!cond) throw new Error(msg);
}

console.log("\n=== End-to-End Pipeline Wiring Smoke Tests ===\n");

// ── 1. Health Checks ──
console.log("[Health Checks]");
for (const [name, url] of [
	["ai-router", AI_ROUTER],
	["delivery", DELIVERY],
	["scheduler", SCHEDULER],
	["user-management", USER_MGMT],
]) {
	await test(`${name} /health`, async () => {
		const r = await fetch(`${url}/health`);
		const j = await r.json();
		assert(r.status === 200 && j.status === "ok", `status=${r.status} body=${JSON.stringify(j)}`);
	});
}

// ── 2. Auth Enforcement ──
console.log("\n[Auth Enforcement]");
await test("rejects missing token", async () => {
	const r = await fetch(`${AI_ROUTER}/internal/process`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			type: "text_message",
			userId: TEST_USER,
			sourceRef: "test",
			correlationId: randomUUID(),
			text: "hi",
		}),
	});
	assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test("rejects invalid token", async () => {
	const r = await fetch(`${AI_ROUTER}/internal/process`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: "Bearer bad" },
		body: JSON.stringify({
			type: "text_message",
			userId: TEST_USER,
			sourceRef: "test",
			correlationId: randomUUID(),
			text: "hi",
		}),
	});
	assert(r.status === 401, `expected 401, got ${r.status}`);
});

// ── 3. Payload Validation ──
console.log("\n[Payload Validation]");
await test("rejects invalid payload (missing required fields)", async () => {
	const token = await makeToken();
	const r = await fetch(`${AI_ROUTER}/internal/process`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
		body: JSON.stringify({ garbage: true }),
	});
	assert(r.status === 400, `expected 400, got ${r.status}`);
	const j = await r.json();
	assert(j.error === "Invalid event payload", `unexpected: ${JSON.stringify(j)}`);
});

await test("rejects non-uuid userId", async () => {
	const token = await makeToken();
	const r = await fetch(`${AI_ROUTER}/internal/process`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
		body: JSON.stringify({
			type: "text_message",
			userId: "not-a-uuid",
			sourceRef: "test",
			correlationId: randomUUID(),
			text: "hi",
		}),
	});
	assert(r.status === 400, `expected 400, got ${r.status}`);
});

// ── 4. Graph Invocation ──
console.log("\n[Graph Invocation]");
await test("accepts valid text_message and invokes graph", async () => {
	const token = await makeToken();
	const r = await fetch(`${AI_ROUTER}/internal/process`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
		body: JSON.stringify({
			type: "text_message",
			userId: TEST_USER,
			sourceRef: "smoke-test",
			correlationId: randomUUID(),
			text: "Hello!",
		}),
	});
	const body = await r.text();
	// Not 400/401 proves auth+validation passed and graph was invoked
	assert(r.status !== 400 && r.status !== 401, `auth/validation error: ${r.status} ${body}`);

	if (r.status === 200) {
		const j = JSON.parse(body);
		assert(j.type, `response missing type: ${body}`);
		assert(typeof j.text === "string", `response missing text: ${body}`);
		console.log(`    -> graph returned: type=${j.type}`);
	} else {
		console.log(`    -> status ${r.status} (graph invoked, downstream error expected w/o OpenAI key)`);
	}
});

// ── 5. Service Connectivity ──
console.log("\n[Service Connectivity from ai-router]");
for (const [name, url] of [
	["delivery", DELIVERY],
	["scheduler", SCHEDULER],
	["user-management", USER_MGMT],
]) {
	await test(`can reach ${name}`, async () => {
		const r = await fetch(`${url}/health`);
		assert(r.status === 200, `${name} unreachable: ${r.status}`);
	});
}

// ── 6. Delivery Routing Endpoint ──
console.log("\n[User Management - Delivery Routing]");
await test("delivery-routing endpoint reachable (correct path)", async () => {
	const token = await makeToken("ai-router", "user-management", TEST_USER);
	const r = await fetch(`${USER_MGMT}/internal/users/${TEST_USER}/delivery-routing`, {
		headers: { authorization: `Bearer ${token}` },
	});
	const body = await r.text();
	// 200 = user found, 404 = test user not in DB — both prove the route exists
	assert(r.status === 200 || r.status === 404, `unexpected: ${r.status} ${body}`);
	console.log(`    -> status ${r.status} (route exists${r.status === 404 ? ", test user not in DB" : ""})`);
});

await test("delivery-routing rejects unauthorized caller", async () => {
	const token = await makeToken("web-ui", "user-management", TEST_USER);
	const r = await fetch(`${USER_MGMT}/internal/users/${TEST_USER}/delivery-routing`, {
		headers: { authorization: `Bearer ${token}` },
	});
	assert(r.status === 403, `expected 403, got ${r.status}`);
});

// ── 7. Scheduler Execute Endpoint ──
console.log("\n[Scheduler - Execute Endpoint]");
await test("scheduler /internal/execute rejects invalid payload", async () => {
	const token = await makeToken("ai-router", "scheduler", TEST_USER);
	const r = await fetch(`${SCHEDULER}/internal/execute`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
		body: JSON.stringify({ bad: "payload" }),
	});
	assert(r.status === 400 || r.status === 422, `expected 400/422, got ${r.status}`);
	console.log(`    -> status ${r.status} (route exists, validates payload)`);
});

// ── 8. Callback Action Event ──
console.log("\n[Callback Action Handling]");
await test("accepts callback_action event type", async () => {
	const token = await makeToken();
	const r = await fetch(`${AI_ROUTER}/internal/process`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
		body: JSON.stringify({
			type: "callback_action",
			userId: TEST_USER,
			sourceRef: "smoke-test",
			correlationId: randomUUID(),
			action: "confirm",
			data: "cmd-123:v1",
		}),
	});
	const body = await r.text();
	assert(r.status !== 400 && r.status !== 401, `auth/validation error: ${r.status} ${body}`);
	if (r.status === 200) {
		console.log(`    -> callback processed: ${body.slice(0, 100)}`);
	} else {
		console.log(`    -> status ${r.status} (callback dispatched to graph)`);
	}
});

// ── Summary ──
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
