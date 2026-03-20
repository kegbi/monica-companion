import { eq } from "drizzle-orm";
import type { Database } from "../db/connection";
import { deliveryAudits } from "../db/schema";

/**
 * Purge all delivery audits for a specific user.
 * Note: user_id is TEXT in this table, so text comparison is used.
 * Returns the number of deleted rows.
 */
export async function purgeUserDeliveryAudits(db: Database, userId: string): Promise<number> {
	const result = await db.delete(deliveryAudits).where(eq(deliveryAudits.userId, userId));
	return (result as unknown as { count: number }).count;
}
