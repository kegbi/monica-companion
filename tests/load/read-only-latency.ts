/**
 * Read-only latency load test.
 *
 * Sends concurrent contact-resolution requests to ai-router and measures
 * response latency at varying concurrency levels and simulated external
 * delays. Compares against the 5s p95 acceptance target.
 *
 * The mock server's RESPONSE_DELAY_MS controls simulated external latency.
 * Run this test multiple times with different RESPONSE_DELAY_MS values
 * (e.g., 100, 500, 1000) to validate the read-only bypass path under
 * varying downstream latency conditions.
 *
 * Prerequisites:
 *   - ai-router running with JWT_SECRET set
 *   - Mock server running as downstream (monica-integration)
 *
 * Usage:
 *   AI_ROUTER_URL=http://localhost:3002 \
 *   JWT_SECRET=<secret> \
 *   npx tsx tests/load/read-only-latency.ts
 */

import * as crypto from "node:crypto";

const AI_ROUTER_URL = process.env.AI_ROUTER_URL ?? "http://localhost:3002";
const JWT_SECRET = process.env.JWT_SECRET;
const CONCURRENCY_LEVELS = [5, 10, 25];
const REQUESTS_PER_LEVEL = 30;
const P95_TARGET_MS = 5000;

if (!JWT_SECRET) {
	console.error("JWT_SECRET is required");
	process.exit(1);
}

interface LevelResult {
	concurrency: number;
	totalRequests: number;
	successCount: number;
	failCount: number;
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	maxMs: number;
	withinTarget: boolean;
}

async function signJwt(secret: string): Promise<string> {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const now = Math.floor(Date.now() / 1000);
	const payload = Buffer.from(
		JSON.stringify({
			iss: "telegram-bridge",
			aud: "ai-router",
			iat: now,
			exp: now + 300,
		}),
	).toString("base64url");
	const signature = crypto
		.createHmac("sha256", secret)
		.update(`${header}.${payload}`)
		.digest("base64url");
	return `${header}.${payload}.${signature}`;
}

async function sendContactResolution(token: string): Promise<{ ok: boolean; latencyMs: number }> {
	const start = Date.now();
	try {
		const res = await fetch(`${AI_ROUTER_URL}/internal/contacts/resolve`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				userId: crypto.randomUUID(),
				query: "Jane Doe",
				correlationId: `load-${crypto.randomUUID()}`,
			}),
			signal: AbortSignal.timeout(10_000),
		});
		return { ok: res.ok, latencyMs: Date.now() - start };
	} catch {
		return { ok: false, latencyMs: Date.now() - start };
	}
}

function percentile(sorted: number[], pct: number): number {
	const idx = Math.ceil((pct / 100) * sorted.length) - 1;
	return sorted[Math.max(0, idx)];
}

async function runLevel(concurrency: number, token: string): Promise<LevelResult> {
	const latencies: number[] = [];
	let success = 0;
	let fail = 0;

	for (let i = 0; i < REQUESTS_PER_LEVEL; i += concurrency) {
		const batch = Math.min(concurrency, REQUESTS_PER_LEVEL - i);
		const results = await Promise.all(
			Array.from({ length: batch }, () => sendContactResolution(token)),
		);
		for (const r of results) {
			latencies.push(r.latencyMs);
			if (r.ok) success++;
			else fail++;
		}
	}

	latencies.sort((a, b) => a - b);
	const p50 = percentile(latencies, 50);
	const p95 = percentile(latencies, 95);
	const p99 = percentile(latencies, 99);

	return {
		concurrency,
		totalRequests: REQUESTS_PER_LEVEL,
		successCount: success,
		failCount: fail,
		p50Ms: p50,
		p95Ms: p95,
		p99Ms: p99,
		maxMs: latencies[latencies.length - 1],
		withinTarget: p95 <= P95_TARGET_MS,
	};
}

async function main(): Promise<void> {
	// JWT_SECRET is guaranteed non-null by the early exit guard above
	const token = await signJwt(JWT_SECRET as string);

	console.log("=== Read-Only Latency Load Test ===\n");
	console.log(`AI Router: ${AI_ROUTER_URL}`);
	console.log(`Requests per level: ${REQUESTS_PER_LEVEL}`);
	console.log(`p95 target: ${P95_TARGET_MS}ms`);
	console.log(`Concurrency levels: ${CONCURRENCY_LEVELS.join(", ")}\n`);

	const results: LevelResult[] = [];

	for (const level of CONCURRENCY_LEVELS) {
		console.log(`--- Concurrency: ${level} ---`);
		const result = await runLevel(level, token);
		results.push(result);
		console.log(
			`  p50=${result.p50Ms}ms  p95=${result.p95Ms}ms  p99=${result.p99Ms}ms  ` +
				`max=${result.maxMs}ms  target=${result.withinTarget ? "PASS" : "FAIL"}`,
		);
	}

	console.log("\n=== Summary ===\n");
	console.table(
		results.map((r) => ({
			concurrency: r.concurrency,
			success: r.successCount,
			fail: r.failCount,
			"p50 (ms)": r.p50Ms,
			"p95 (ms)": r.p95Ms,
			"p99 (ms)": r.p99Ms,
			"max (ms)": r.maxMs,
			"p95 target": r.withinTarget ? "PASS" : "FAIL",
		})),
	);

	const allPass = results.every((r) => r.withinTarget);
	console.log(
		allPass
			? "\nAll concurrency levels within p95 target."
			: "\nSome concurrency levels exceeded p95 target!",
	);

	process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
	console.error("Load test failed:", err);
	process.exit(1);
});
