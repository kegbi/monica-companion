import { metrics } from "@opentelemetry/api";

export interface QueueMetrics {
	recordJobWaitDuration(queueName: string, seconds: number): void;
	recordJobProcessDuration(queueName: string, status: string, seconds: number): void;
	updateQueueDepth(queueName: string, state: string, count: number): void;
	recordRetry(queueName: string): void;
	recordDeadLetter(queueName: string): void;
	recordReminderOnTime(): void;
	recordReminderLate(): void;
	recordReminderMissed(): void;
}

/**
 * Create OTel metric instruments for BullMQ queue observability.
 *
 * Metric naming follows the `scheduler.queue.*` and `scheduler.reminder.*`
 * conventions. Instruments are created once at startup and reused across
 * worker event handlers.
 */
export function createQueueMetrics(): QueueMetrics {
	const meter = metrics.getMeter("scheduler");

	const jobWaitDuration = meter.createHistogram("scheduler.queue.job_wait_duration_seconds", {
		description: "Time from enqueue to processing start",
		unit: "s",
	});

	const jobProcessDuration = meter.createHistogram("scheduler.queue.job_process_duration_seconds", {
		description: "Job processing time",
		unit: "s",
	});

	const queueDepth = meter.createGauge("scheduler.queue.depth", {
		description: "Current number of jobs by queue and state",
	});

	const retryTotal = meter.createCounter("scheduler.queue.retry_total", {
		description: "Total retries by queue",
	});

	const deadLetterTotal = meter.createCounter("scheduler.queue.dead_letter_total", {
		description: "Total dead-lettered jobs by queue",
	});

	const reminderOnTime = meter.createCounter("scheduler.reminder.on_time", {
		description: "Reminders delivered within 5 min of scheduled time",
	});

	const reminderLate = meter.createCounter("scheduler.reminder.late", {
		description: "Reminders delivered more than 5 min late",
	});

	const reminderMissed = meter.createCounter("scheduler.reminder.missed", {
		description: "Reminders that hit catch-up or were skipped",
	});

	return {
		recordJobWaitDuration(queueName: string, seconds: number) {
			jobWaitDuration.record(seconds, { queue_name: queueName });
		},
		recordJobProcessDuration(queueName: string, status: string, seconds: number) {
			jobProcessDuration.record(seconds, { queue_name: queueName, status });
		},
		updateQueueDepth(queueName: string, state: string, count: number) {
			queueDepth.record(count, { queue_name: queueName, state });
		},
		recordRetry(queueName: string) {
			retryTotal.add(1, { queue_name: queueName });
		},
		recordDeadLetter(queueName: string) {
			deadLetterTotal.add(1, { queue_name: queueName });
		},
		recordReminderOnTime() {
			reminderOnTime.add(1);
		},
		recordReminderLate() {
			reminderLate.add(1);
		},
		recordReminderMissed() {
			reminderMissed.add(1);
		},
	};
}
