import { createServiceClient } from "@monica-companion/auth";
import { IdempotencyStore } from "@monica-companion/idempotency";
import { createLogger } from "@monica-companion/observability";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { telemetry } from "./instrumentation";

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

	// BullMQ queues
	const commandQueue = new Queue("command-execution", { connection: redis });
	const reminderQueue = new Queue("reminder-execute", { connection: redis });
	const reminderPollQueue = new Queue("reminder-poll", { connection: redis });

	// Create the HTTP app
	const app = createApp(config, {
		idempotencyStore,
		db,
		commandQueue,
	});

	// --- Command execution worker ---
	const commandWorker = new Worker(
		"command-execution",
		async (job) => {
			await processCommandJob(job.data, {
				monicaClient,
				deliveryClient,
				idempotencyStore,
				db: db as never,
			});
		},
		{
			connection: redis,
			concurrency: 5,
			removeOnComplete: { count: 1000 },
			removeOnFail: { count: 5000 },
		},
	);

	commandWorker.on("failed", async (job, error) => {
		if (job && job.attemptsMade >= config.maxRetries) {
			await handleDeadLetter(
				{
					jobId: job.id ?? "unknown",
					queue: "command-execution",
					executionId: job.data.executionId,
					userId: job.data.command.userId,
					correlationId: job.data.correlationId,
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
			await executeReminder(job.data, {
				monicaClient,
				deliveryClient,
				db: db as never,
			});
		},
		{
			connection: redis,
			concurrency: 5,
			removeOnComplete: { count: 1000 },
			removeOnFail: { count: 5000 },
		},
	);

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

	// Start HTTP server
	const port = config.port;
	serve({ fetch: app.fetch, port }, (info) => {
		logger.info(`scheduler listening on :${info.port}`);
	});

	// Graceful shutdown
	const shutdown = async () => {
		logger.info("Shutting down scheduler");
		await commandWorker.close();
		await reminderWorker.close();
		await reminderPollWorker.close();
		await commandQueue.close();
		await reminderQueue.close();
		await reminderPollQueue.close();
		await redis.quit();
		await telemetry.shutdown();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	logger.error("Failed to start scheduler", {
		error: err instanceof Error ? err.message : String(err),
	});
	process.exit(1);
});
