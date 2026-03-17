import { metrics } from "@opentelemetry/api";

export interface GuardrailMetrics {
	recordRateLimitRejection(modelType: string, service: string): void;
	recordConcurrencyRejection(modelType: string, service: string): void;
	updateBudgetSpend(usd: number): void;
	updateBudgetLimit(usd: number): void;
	updateBudgetAlarm(active: boolean): void;
	recordBudgetExhaustion(): void;
	updateKillSwitch(active: boolean): void;
	recordKillSwitchRejection(service: string): void;
	recordRequestAllowed(modelType: string, service: string): void;
}

export function createGuardrailMetrics(): GuardrailMetrics {
	const meter = metrics.getMeter("guardrails");

	const rateLimitRejected = meter.createCounter("guardrail.rate_limit.rejected_total", {
		description: "Total rate-limit rejections",
	});

	const concurrencyRejected = meter.createCounter("guardrail.concurrency.rejected_total", {
		description: "Total concurrency-gate rejections",
	});

	const budgetSpend = meter.createGauge("guardrail.budget.current_spend_usd", {
		description: "Current month cumulative spend in USD",
	});

	const budgetLimit = meter.createGauge("guardrail.budget.limit_usd", {
		description: "Configured budget limit",
	});

	const budgetAlarmActive = meter.createGauge("guardrail.budget.alarm_active", {
		description: "1 when spend exceeds alarm threshold, 0 otherwise",
	});

	const budgetExhausted = meter.createCounter("guardrail.budget.exhausted_total", {
		description: "Total budget-exhaustion rejections",
	});

	const killSwitchActive = meter.createGauge("guardrail.kill_switch.active", {
		description: "1 when kill switch is on",
	});

	const killSwitchRejected = meter.createCounter("guardrail.kill_switch.rejected_total", {
		description: "Total kill-switch rejections",
	});

	const requestAllowed = meter.createCounter("guardrail.request.allowed_total", {
		description: "Total requests that passed all guardrails",
	});

	return {
		recordRateLimitRejection(modelType: string, service: string) {
			rateLimitRejected.add(1, { model_type: modelType, service });
		},
		recordConcurrencyRejection(modelType: string, service: string) {
			concurrencyRejected.add(1, { model_type: modelType, service });
		},
		updateBudgetSpend(usd: number) {
			budgetSpend.record(usd);
		},
		updateBudgetLimit(usd: number) {
			budgetLimit.record(usd);
		},
		updateBudgetAlarm(active: boolean) {
			budgetAlarmActive.record(active ? 1 : 0);
		},
		recordBudgetExhaustion() {
			budgetExhausted.add(1);
		},
		updateKillSwitch(active: boolean) {
			killSwitchActive.record(active ? 1 : 0);
		},
		recordKillSwitchRejection(service: string) {
			killSwitchRejected.add(1, { service });
		},
		recordRequestAllowed(modelType: string, service: string) {
			requestAllowed.add(1, { model_type: modelType, service });
		},
	};
}
