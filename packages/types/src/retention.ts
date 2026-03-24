import { z } from "zod/v4";

/**
 * ISO 8601 datetime string validator.
 * Accepts strings that parse to a valid Date via the Date constructor.
 */
const isoDateString = z
	.string()
	.refine((s) => !Number.isNaN(new Date(s).getTime()), { message: "Invalid ISO date string" });

/**
 * Request body for POST /internal/retention-cleanup on ai-router.
 */
export const AiRouterRetentionCleanupRequestSchema = z.object({
	conversationHistoryCutoff: isoDateString,
});
export type AiRouterRetentionCleanupRequest = z.infer<typeof AiRouterRetentionCleanupRequestSchema>;

/**
 * Request body for POST /internal/retention-cleanup on delivery.
 */
export const DeliveryRetentionCleanupRequestSchema = z.object({
	deliveryAuditsCutoff: isoDateString,
});
export type DeliveryRetentionCleanupRequest = z.infer<typeof DeliveryRetentionCleanupRequestSchema>;

/**
 * Response from retention cleanup endpoints.
 */
export const RetentionCleanupResponseSchema = z.object({
	purged: z.record(z.string(), z.number()),
});
export type RetentionCleanupResponse = z.infer<typeof RetentionCleanupResponseSchema>;

/**
 * Response from user-specific data purge endpoints.
 */
export const UserDataPurgeResponseSchema = z.object({
	purged: z.record(z.string(), z.number()),
});
export type UserDataPurgeResponse = z.infer<typeof UserDataPurgeResponseSchema>;

/**
 * Response from the disconnect endpoint on user-management.
 */
export const DisconnectUserResponseSchema = z.object({
	disconnected: z.boolean(),
	purgeScheduledAt: z.string(),
});
export type DisconnectUserResponse = z.infer<typeof DisconnectUserResponseSchema>;
