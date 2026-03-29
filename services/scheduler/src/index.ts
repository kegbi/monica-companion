import { createServiceClient } from "@monica-companion/auth";
import { IdempotencyStore } from "@monica-companion/idempotency";
import { createLogger } from "@monica-companion/observability";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { telemetry } from "./instrumentation";
import { createQueueMetrics } from "./lib/queue-metrics";

const logger = createLogger("scheduler");

async function main() {
	const { serve } = await import("@hono/node-server");
	const { createApp } = await import("./app");
	const { loadConfig } = await import("./config");
	const { createDb } = await import("./db/connection");
	const { processCommandJob } = await import("./workers/command-worker");
	const { pollReminders } = await import("./workers/reminder-poller");
	const { executeReminder } = await import("./workers/reminder-executor");
	const { handleDeadLetter } = await import("./lib/dead-letter");
	const { processRetentionCleanup } = await import("./workers/retention-cleanup-worker");
	const { purgeExpiredExecutions, purgeExpiredIdempotencyKeys, purgeExpiredReminderWindows } =
		await import("./retention/cleanup");

	const config = loadConfig();
	const db = createDb(config.databaseUrl);
	const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

	const idempotencyStore = new IdempotencyStore(db as never);

	// Create service clients with explicit timeout (per review M3)
	const monicaClient = createServiceClient({
		issuer: "scheduler",
		audience: "monica-integration",
		secret: config.auth.jwtSecrets[0],
		baseUrl: config.monicaIntegrationUrl,
	});

	const deliveryClient = createServiceClient({
		issuer: "scheduler",
		audience: "delivery",
		secret: config.auth.jwtSecrets[0],
		baseUrl: config.deliveryUrl,
	});

	const userManagementClient = createServiceClient({
		issuer: "scheduler",
		audience: "user-management",
		secret: config.auth.jwtSecrets[0],
		baseUrl: config.userManagementUrl,
	});

	const aiRouterClient = createServiceClient({
		issuer: "scheduler",
		audience: "ai-router",
		secret: config.auth.jwtSecrets[0],
		baseUrl: config.aiRouterUrl,
	});

	// Queue metrics (OTel instruments)
	const queueMetrics = createQueueMetrics();

	// BullMQ queues
	const commandQueue = new Queue("command-execution", { connection: redis });
	const reminderQueue = new Queue("reminder-execute", { connection: redis });
	const reminderPollQueue = new Queue("reminder-poll", { connection: redis });

	// Synchronous command processor for ai-router calls (bypasses BullMQ queue)
	const workerDeps = {
		monicaClient,
		deliveryClient,
		userManagementClient,
		idempotencyStore,
		db: db as never,
	};

	// Create the HTTP app
	const app = createApp(config, {
		idempotencyStore,
		db,
		commandQueue,
		processSync: (data) => processCommandJob(data as never, workerDeps),
	});

	/**
	 * Resolves connector routing for dead-letter notifications.
	 * Tries the command payload first, then falls back to user-management.
	 */
	async function resolveConnectorRoutingForDeadLetter(command: {
		userId: string;
		connectorType?: string;
		connectorRoutingId?: string;
	}): Promise<{ connectorType: string; connectorRoutingId: string }> {
		if (command.connectorType && command.connectorRoutingId) {
			return {
				connectorType: command.connectorType,
				connectorRoutingId: command.connectorRoutingId,
			};
		}

		try {
			const response = await userManagementClient.fetch(
				`/internal/users/${command.userId}/schedule`,
				{ method: "GET" },
			);
			if (response.ok) {
				const schedule = (await response.json()) as {
					connectorType: string;
					connectorRoutingId: string;
				};
				return {
					connectorType: schedule.connectorType,
					connectorRoutingId: schedule.connectorRoutingId,
				};
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			logger.warn("Failed to resolve connector routing for dead-letter notification", {
				userId: command.userId,
				error: msg,
			});
		}

		// Last resort: cannot resolve routing, dead-letter notification will fail
		// at delivery validation (connectorRoutingId min(1)), which is acceptable
		// because dead-letter notification is best-effort.
		return { connectorType: "unknown", connectorRoutingId: "unresolved" };
	}

	// --- Command execution worker ---
	const commandWorker = new Worker(
		"command-execution",
		async (job) => {
			// Record wait duration (time from enqueue to processing start)
			if (job.timestamp) {
				const waitMs = Date.now() - job.timestamp;
				queueMetrics.recordJobWaitDuration("command-execution", waitMs / 1000);
			}

			const startMs = Date.now();
			try {
				await processCommandJob(job.data, {
					monicaClient,
					deliveryClient,
					userManagementClient,
					idempotencyStore,
					db: db as never,
				});
				queueMetrics.recordJobProcessDuration(
					"command-execution",
					"completed",
					(Date.now() - startMs) / 1000,
				);
			} catch (err) {
				queueMetrics.recordJobProcessDuration(
					"command-execution",
					"failed",
					(Date.now() - startMs) / 1000,
				);
				throw err;
			}
		},
		{
			connection: redis,
			concurrency: 5,
			removeOnComplete: { count: 1000 },
			removeOnFail: { count: 5000 },
		},
	);

	commandWorker.on("failed", async (job, error) => {
		if (job) {
			queueMetrics.recordRetry("command-execution");
		}
		if (job && job.attemptsMade >= config.maxRetries) {
			queueMetrics.recordDeadLetter("command-execution");
			const routing = await resolveConnectorRoutingForDeadLetter(job.data.command);
			await handleDeadLetter(
				{
					jobId: job.id ?? "unknown",
					queue: "command-execution",
					executionId: job.data.executionId,
					userId: job.data.command.userId,
					correlationId: job.data.correlationId,
					connectorType: routing.connectorType,
					connectorRoutingId: routing.connectorRoutingId,
					error: error.message,
					attemptCount: job.attemptsMade,
					payload: job.data.command.payload,
				},
				{ deliveryClient, db: db as never, logger },
			);
		}
	});

	// --- Reminder execution worker ---
	const reminderWorker = new Worker(
		"reminder-execute",
		async (job) => {
			// Record wait duration
			if (job.timestamp) {
				const waitMs = Date.now() - job.timestamp;
				queueMetrics.recordJobWaitDuration("reminder-execute", waitMs / 1000);
			}

			const startMs = Date.now();
			try {
				await executeReminder(job.data, {
					monicaClient,
					deliveryClient,
					db: db as never,
				});
				queueMetrics.recordJobProcessDuration(
					"reminder-execute",
					"completed",
					(Date.now() - startMs) / 1000,
				);
			} catch (err) {
				queueMetrics.recordJobProcessDuration(
					"reminder-execute",
					"failed",
					(Date.now() - startMs) / 1000,
				);
				throw err;
			}
		},
		{
			connection: redis,
			concurrency: 5,
			removeOnComplete: { count: 1000 },
			removeOnFail: { count: 5000 },
		},
	);

	reminderWorker.on("failed", (job) => {
		if (job) {
			queueMetrics.recordRetry("reminder-execute");
		}
	});

	// --- Reminder poll repeatable job ---
	await reminderPollQueue.upsertJobScheduler(
		"reminder-poll-scheduler",
		{ every: config.reminderPollIntervalMs },
		{ name: "poll-reminders" },
	);

	const reminderPollWorker = new Worker(
		"reminder-poll",
		async () => {
			await pollReminders({
				userManagementClient,
				db: db as never,
				reminderQueue,
				catchUpWindowHours: config.catchUpWindowHours,
			});
		},
		{
			connection: redis,
			concurrency: 1,
			removeOnComplete: { count: 100 },
			removeOnFail: { count: 100 },
		},
	);

	// --- Retention cleanup repeatable job ---
	const retentionCleanupQueue = new Queue("retention-cleanup", { connection: redis });

	await retentionCleanupQueue.upsertJobScheduler(
		"retention-cleanup-scheduler",
		{ every: config.retentionCleanupIntervalMs },
		{ name: "retention-cleanup" },
	);

	const retentionCleanupWorker = new Worker(
		"retention-cleanup",
		async () => {
			await processRetentionCleanup({
				config,
				db: db as never,
				aiRouterClient,
				deliveryClient,
				purgeExpiredExecutions,
				purgeExpiredIdempotencyKeys,
				purgeExpiredReminderWindows,
			});
		},
		{
			connection: redis,
			concurrency: 1,
			removeOnComplete: { count: 100 },
			removeOnFail: { count: 100 },
		},
	);

	// --- Periodic queue depth poller ---
	// Polls queue depth every 15s, aligned with the Prometheus scrape interval (15s)
	// to ensure each scrape sees a fresh gauge value.
	const QUEUE_DEPTH_POLL_INTERVAL_MS = 15_000;
	const depthPollInterval = setInterval(async () => {
		try {
			for (const [name, queue] of [
				["command-execution", commandQueue],
				["reminder-execute", reminderQueue],
				["reminder-poll", reminderPollQueue],
				["retention-cleanup", retentionCleanupQueue],
			] as const) {
				const counts = await queue.getJobCounts("waiting", "active", "delayed");
				queueMetrics.updateQueueDepth(name, "waiting", counts.waiting ?? 0);
				queueMetrics.updateQueueDepth(name, "active", counts.active ?? 0);
				queueMetrics.updateQueueDepth(name, "delayed", counts.delayed ?? 0);
			}
		} catch (err) {
			logger.warn("Failed to poll queue depth", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}, QUEUE_DEPTH_POLL_INTERVAL_MS);

	// Start HTTP server
	const port = config.port;
	serve({ fetch: app.fetch, port }, (info) => {
		logger.info(`scheduler listening on :${info.port}`);
	});

	// Graceful shutdown
	const shutdown = async () => {
		logger.info("Shutting down scheduler");
		clearInterval(depthPollInterval);
		await commandWorker.close();
		await reminderWorker.close();
		await reminderPollWorker.close();
		await retentionCleanupWorker.close();
		await commandQueue.close();
		await reminderQueue.close();
		await reminderPollQueue.close();
		await retentionCleanupQueue.close();
		await redis.quit();
		await telemetry.shutdown();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	const msg = err instanceof Error ? err.message : String(err);
	logger.error("Failed to start scheduler", { error: msg });
	console.error("[scheduler] Fatal:", msg);
	process.exit(1);
});
