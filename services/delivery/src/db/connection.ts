import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>["db"];

export function createDb(connectionString: string) {
	const sql = postgres(connectionString);
	const db = drizzle(sql, { schema });
	return { db, sql };
}
