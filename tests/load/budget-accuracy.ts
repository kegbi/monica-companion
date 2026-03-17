/**
 * Budget accuracy verification script.
 *
 * Compares the guardrail budget spend value stored in Redis against the
 * OTel gauge value reported to Prometheus. Both should track within a
 * small tolerance (scrape lag).
 *
 * Prerequisites:
 *   - Redis running with guardrail budget keys
 *   - Prometheus scraping OTel collector metrics
 *
 * Usage:
 *   REDIS_URL=redis://localhost:6379 \
 *   PROMETHEUS_URL=http://localhost:9090 \
 *   npx tsx tests/load/budget-accuracy.ts
 */

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? "http://localhost:9090";
const TOLERANCE_USD = 0.05; // Allow $0.05 tolerance due to scrape lag

async function queryPrometheusGauge(metric: string): Promise<number | null> {
	try {
		const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(metric)}`;
		const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
		const data = await res.json();
		const value = (data as { data?: { result?: Array<{ value?: [number, string] }> } }).data
			?.result?.[0]?.value?.[1];
		return value ? Number.parseFloat(value) : null;
	} catch {
		return null;
	}
}

async function main(): Promise<void> {
	const IORedis = (await import("ioredis")).default;

	console.log("=== Budget Accuracy Verification ===\n");
	console.log(`Redis: ${REDIS_URL}`);
	console.log(`Prometheus: ${PROMETHEUS_URL}`);
	console.log(`Tolerance: $${TOLERANCE_USD}\n`);

	const redis = new IORedis(REDIS_URL);

	// Read budget spend from Redis (guardrail key pattern)
	const redisSpend = await redis.get("guardrail:budget:spend");
	const redisLimit = await redis.get("guardrail:budget:limit");
	const redisSpendUsd = redisSpend ? Number.parseFloat(redisSpend) : 0;
	const redisLimitUsd = redisLimit ? Number.parseFloat(redisLimit) : 0;

	console.log(`Redis budget spend:  $${redisSpendUsd.toFixed(4)}`);
	console.log(`Redis budget limit:  $${redisLimitUsd.toFixed(4)}`);

	// Read from Prometheus
	const promSpend = await queryPrometheusGauge("guardrail_budget_current_spend_usd");
	const promLimit = await queryPrometheusGauge("guardrail_budget_limit_usd");

	console.log(
		`Prom budget spend:   ${promSpend !== null ? `$${promSpend.toFixed(4)}` : "N/A (no data)"}`,
	);
	console.log(
		`Prom budget limit:   ${promLimit !== null ? `$${promLimit?.toFixed(4)}` : "N/A (no data)"}`,
	);

	console.log("\n=== Comparison ===\n");

	if (promSpend === null) {
		console.log(
			"  Spend: No Prometheus data available. Guardrails may not have been exercised yet.",
		);
		console.log("  This is expected if no AI requests have been made during this test run.");
	} else {
		const spendDiff = Math.abs(redisSpendUsd - promSpend);
		const spendOk = spendDiff <= TOLERANCE_USD;
		console.log(
			`  Spend delta: $${spendDiff.toFixed(4)} ${spendOk ? "(PASS)" : `(FAIL - exceeds $${TOLERANCE_USD} tolerance)`}`,
		);
	}

	if (promLimit === null) {
		console.log("  Limit: No Prometheus data available.");
	} else {
		const limitDiff = Math.abs(redisLimitUsd - (promLimit ?? 0));
		const limitOk = limitDiff <= TOLERANCE_USD;
		console.log(
			`  Limit delta: $${limitDiff.toFixed(4)} ${limitOk ? "(PASS)" : `(FAIL - exceeds $${TOLERANCE_USD} tolerance)`}`,
		);
	}

	await redis.quit();
}

main().catch((err) => {
	console.error("Budget accuracy check failed:", err);
	process.exit(1);
});
