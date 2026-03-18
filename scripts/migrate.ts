/**
 * Programmatic Drizzle migration runner.
 *
 * Usage: tsx scripts/migrate.ts <service-name>
 * Example: tsx scripts/migrate.ts ai-router
 *
 * Reads DATABASE_URL from env and applies migrations from
 * services/<service-name>/drizzle/ using drizzle-orm's migrate().
 * Idempotent — safe to run on every startup.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const scriptDir = resolve(fileURLToPath(import.meta.url), "..");

async function main() {
	const serviceName = process.argv[2];
	if (!serviceName) {
		console.error("Usage: tsx scripts/migrate.ts <service-name>");
		process.exit(1);
	}

	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		console.error("DATABASE_URL environment variable is required");
		process.exit(1);
	}

	const migrationsFolder = resolve(scriptDir, "..", "services", serviceName, "drizzle");

	console.log(`[migrate] Running migrations for ${serviceName} from ${migrationsFolder}`);

	const client = postgres(databaseUrl, { max: 1 });
	const db = drizzle(client);

	// Each service uses its own migration tracking table to avoid conflicts
	// when multiple services share the same database.
	const migrationsTable = `__drizzle_migrations_${serviceName.replace(/-/g, "_")}`;

	try {
		await migrate(db, { migrationsFolder, migrationsTable, migrationsSchema: "drizzle" });
		console.log(`[migrate] ${serviceName} migrations applied successfully`);
	} catch (err) {
		console.error(
			`[migrate] ${serviceName} migration failed:`,
			err instanceof Error ? err.message : err,
		);
		process.exit(1);
	} finally {
		await client.end();
	}
}

main();
