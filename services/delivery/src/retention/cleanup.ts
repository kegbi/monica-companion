import { lt } from "drizzle-orm";
import type { Database } from "../db/connection";
import { deliveryAudits } from "../db/schema";

/**
 * Purge delivery audits older than the cutoff date.
 * Returns the number of deleted rows.
 */
export async function purgeExpiredDeliveryAudits(db: Database, cutoffDate: Date): Promise<number> {
	const result = await db.delete(deliveryAudits).where(lt(deliveryAudits.createdAt, cutoffDate));
	return (result as unknown as { count: number }).count;
}
