import type { IdempotencyStore } from "@monica-companion/idempotency";
import { otelMiddleware } from "@monica-companion/observability";
import { Hono } from "hono";
import type { Config } from "./config";
import { userPurgeRoutes } from "./retention/user-purge-routes";
import { executeRoutes } from "./routes/execute";

export interface AppDeps {
	idempotencyStore: IdempotencyStore;
	db: unknown;
	commandQueue: { add: (name: string, data: unknown) => Promise<unknown> };
}

export function createApp(config: Config, deps: AppDeps) {
	const app = new Hono();

	app.use(otelMiddleware());

	app.get("/health", (c) => c.json({ status: "ok", service: "scheduler" }));

	const execute = executeRoutes({
		config,
		idempotencyStore: deps.idempotencyStore,
		db: deps.db,
		commandQueue: deps.commandQueue,
	});
	app.route("/internal", execute);

	// User data purge routes (own per-endpoint auth, caller: user-management only)
	app.route("/internal", userPurgeRoutes(config, deps.db as never));

	return app;
}
