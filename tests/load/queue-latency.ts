/**
 * Queue latency load test.
 *
 * Enqueues N confirmed commands at varying concurrency levels against the
 * scheduler HTTP endpoint, then queries Prometheus for latency percentiles.
 *
 * Prerequisites:
 *   - Scheduler running with JWT_SECRET set
 *   - Prometheus scraping OTel collector metrics
 *   - Mock server running for downstream services
 *
 * Usage:
 *   SCHEDULER_URL=http://localhost:3005 \
 *   PROMETHEUS_URL=http://localhost:9090 \
 *   JWT_SECRET=<secret> \
 *   npx tsx tests/load/queue-latency.ts
 */

import * as crypto from "node:crypto";

const SCHEDULER_URL = process.env.SCHEDULER_URL ?? "http://localhost:3005";
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? "http://localhost:9090";
const JWT_SECRET = process.env.JWT_SECRET;
const CONCURRENCY_LEVELS = [5, 10, 25];
const JOBS_PER_LEVEL = 20;

if (!JWT_SECRET) {
	console.error("JWT_SECRET is required");
	process.exit(1);
}

interface LatencyResult {
	concurrency: number;
	totalJobs: number;
	enqueueDurationMs: number;
	successCount: number;
	failCount: number;
}

async function signJwt(secret: string): Promise<string> {
	// Minimal JWT for service-to-service auth (HS256)
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const now = Math.floor(Date.now() / 1000);
	const payload = Buffer.from(
		JSON.stringify({
			iss: "ai-router",
			aud: "scheduler",
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

function makeCommandPayload(): object {
	return {
		executionId: crypto.randomUUID(),
		command: {
			pendingCommandId: crypto.randomUUID(),
			userId: crypto.randomUUID(),
			commandType: "create_contact",
			payload: {
				type: "create_contact",
				firstName: "LoadTest",
				genderId: 1,
			},
			idempotencyKey: `${crypto.randomUUID()}:v1`,
			correlationId: `load-${crypto.randomUUID()}`,
			confirmedAt: new Date().toISOString(),
		},
		correlationId: `load-${crypto.randomUUID()}`,
	};
}

async function enqueueCommand(token: string): Promise<boolean> {
	try {
		const res = await fetch(`${SCHEDULER_URL}/internal/execute`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(makeCommandPayload()),
			signal: AbortSignal.timeout(10_000),
		});
		return res.ok || res.status === 409; // 409 = idempotency duplicate, still counts
	} catch {
		return false;
	}
}

async function runConcurrencyLevel(concurrency: number, token: string): Promise<LatencyResult> {
	const start = Date.now();
	let success = 0;
	let fail = 0;

	// Process in batches of `concurrency`
	for (let i = 0; i < JOBS_PER_LEVEL; i += concurrency) {
		const batch = Math.min(concurrency, JOBS_PER_LEVEL - i);
		const results = await Promise.all(Array.from({ length: batch }, () => enqueueCommand(token)));
		for (const ok of results) {
			if (ok) success++;
			else fail++;
		}
	}

	return {
		concurrency,
		totalJobs: JOBS_PER_LEVEL,
		enqueueDurationMs: Date.now() - start,
		successCount: success,
		failCount: fail,
	};
}

async function queryPrometheus(query: string): Promise<string> {
	const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
		const data = await res.json();
		const result = (data as { data?: { result?: Array<{ value?: [number, string] }> } }).data
			?.result?.[0]?.value?.[1];
		return result ?? "N/A";
	} catch {
		return "query_failed";
	}
}

async function main(): Promise<void> {
	// JWT_SECRET is guaranteed non-null by the early exit guard above
	const token = await signJwt(JWT_SECRET as string);

	console.log("=== Queue Latency Load Test ===\n");
	console.log(`Scheduler: ${SCHEDULER_URL}`);
	console.log(`Prometheus: ${PROMETHEUS_URL}`);
	console.log(`Jobs per level: ${JOBS_PER_LEVEL}`);
	console.log(`Concurrency levels: ${CONCURRENCY_LEVELS.join(", ")}\n`);

	const results: LatencyResult[] = [];

	for (const level of CONCURRENCY_LEVELS) {
		console.log(`--- Concurrency: ${level} ---`);
		const result = await runConcurrencyLevel(level, token);
		results.push(result);
		console.log(
			`  Enqueue: ${result.enqueueDurationMs}ms, OK: ${result.successCount}, Fail: ${result.failCount}`,
		);
	}

	// Wait for Prometheus to scrape the latest metrics
	console.log("\nWaiting 30s for Prometheus scrape...");
	await new Promise((r) => setTimeout(r, 30_000));

	console.log("\n=== Prometheus Latency Queries ===\n");

	const queries = [
		[
			"Wait p50",
			"histogram_quantile(0.5, sum(rate(scheduler_queue_job_wait_duration_seconds_bucket[5m])) by (le))",
		],
		[
			"Wait p95",
			"histogram_quantile(0.95, sum(rate(scheduler_queue_job_wait_duration_seconds_bucket[5m])) by (le))",
		],
		[
			"Wait p99",
			"histogram_quantile(0.99, sum(rate(scheduler_queue_job_wait_duration_seconds_bucket[5m])) by (le))",
		],
		[
			"Process p50",
			"histogram_quantile(0.5, sum(rate(scheduler_queue_job_process_duration_seconds_bucket[5m])) by (le))",
		],
		[
			"Process p95",
			"histogram_quantile(0.95, sum(rate(scheduler_queue_job_process_duration_seconds_bucket[5m])) by (le))",
		],
		["Retry total", "sum(scheduler_queue_retry_total)"],
		["Dead letter total", "sum(scheduler_queue_dead_letter_total)"],
	];

	for (const [label, query] of queries) {
		const value = await queryPrometheus(query);
		console.log(`  ${label}: ${value}`);
	}

	console.log("\n=== Summary ===\n");
	console.table(results);
}

main().catch((err) => {
	console.error("Load test failed:", err);
	process.exit(1);
});
