import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
	const client = postgres(connectionString);
	return drizzle(client, { schema });
}

let db: Database | null = null;

export function getDb(connectionString?: string): Database {
	if (!db) {
		const url = connectionString ?? process.env.DATABASE_URL;
		if (!url) {
			throw new Error("DATABASE_URL is required");
		}
		db = createDb(url);
	}
	return db;
}
