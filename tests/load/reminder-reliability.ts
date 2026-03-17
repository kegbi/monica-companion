/**
 * Reminder reliability load test.
 *
 * Inserts test reminder jobs into the BullMQ reminder-execute queue and
 * measures on-time delivery rate via Prometheus counters.
 *
 * Prerequisites:
 *   - Scheduler running with Redis
 *   - Mock server running as downstream (monica-integration, delivery)
 *   - Prometheus scraping OTel collector metrics
 *
 * Usage:
 *   REDIS_URL=redis://localhost:6379 \
 *   PROMETHEUS_URL=http://localhost:9090 \
 *   npx tsx tests/load/reminder-reliability.ts
 */

import * as crypto from "node:crypto";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? "http://localhost:9090";
const REMINDER_COUNT = 15;

async function main(): Promise<void> {
	// Dynamic import to avoid requiring ioredis at lint time
	const IORedis = (await import("ioredis")).default;
	const { Queue } = await import("bullmq");

	console.log("=== Reminder Reliability Load Test ===\n");
	console.log(`Redis: ${REDIS_URL}`);
	console.log(`Prometheus: ${PROMETHEUS_URL}`);
	console.log(`Reminder count: ${REMINDER_COUNT}\n`);

	const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
	const reminderQueue = new Queue("reminder-execute", { connection: redis });

	// Record Prometheus counters before
	const beforeOnTime = await queryCounter("scheduler_reminder_on_time");
	const beforeLate = await queryCounter("scheduler_reminder_late");
	const beforeMissed = await queryCounter("scheduler_reminder_missed");

	console.log(`Before: on_time=${beforeOnTime}, late=${beforeLate}, missed=${beforeMissed}\n`);

	// Enqueue reminder jobs
	console.log(`Enqueuing ${REMINDER_COUNT} reminder jobs...`);
	for (let i = 0; i < REMINDER_COUNT; i++) {
		const windowId = `load-test-${Date.now()}-${i}`;
		await reminderQueue.add(
			"reminder-execute",
			{
				userId: crypto.randomUUID(),
				connectorType: "telegram",
				connectorRoutingId: "load-test",
				correlationId: `load-${crypto.randomUUID()}`,
				windowId,
			},
			{
				attempts: 3,
				backoff: { type: "exponential", delay: 1000 },
			},
		);
	}
	console.log("All jobs enqueued.\n");

	// Wait for jobs to be processed + Prometheus scrape
	console.log("Waiting 45s for processing + Prometheus scrape...");
	await new Promise((r) => setTimeout(r, 45_000));

	// Record Prometheus counters after
	const afterOnTime = await queryCounter("scheduler_reminder_on_time");
	const afterLate = await queryCounter("scheduler_reminder_late");
	const afterMissed = await queryCounter("scheduler_reminder_missed");

	console.log(`\nAfter: on_time=${afterOnTime}, late=${afterLate}, missed=${afterMissed}`);

	const deltaOnTime = afterOnTime - beforeOnTime;
	const deltaLate = afterLate - beforeLate;
	const deltaMissed = afterMissed - beforeMissed;
	const totalProcessed = deltaOnTime + deltaLate + deltaMissed;

	console.log("\n=== Results ===\n");
	console.log(`  Jobs enqueued:    ${REMINDER_COUNT}`);
	console.log(`  On-time:          ${deltaOnTime}`);
	console.log(`  Late:             ${deltaLate}`);
	console.log(`  Missed:           ${deltaMissed}`);
	console.log(`  Total processed:  ${totalProcessed}`);

	if (totalProcessed > 0) {
		const onTimeRate = ((deltaOnTime / totalProcessed) * 100).toFixed(1);
		console.log(`  On-time rate:     ${onTimeRate}%`);
	}

	await reminderQueue.close();
	await redis.quit();
}

async function queryCounter(metricName: string): Promise<number> {
	try {
		const url = `${PROMETHEUS_URL}/api/v1/query?query=sum(${metricName}) or vector(0)`;
		const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
		const data = await res.json();
		const value = (data as { data?: { result?: Array<{ value?: [number, string] }> } }).data
			?.result?.[0]?.value?.[1];
		return Number.parseFloat(value ?? "0");
	} catch {
		return 0;
	}
}

main().catch((err) => {
	console.error("Load test failed:", err);
	process.exit(1);
});
