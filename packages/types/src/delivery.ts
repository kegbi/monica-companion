import { z } from "zod/v4";

export const DeliveryResponseStatusSchema = z.enum(["delivered", "failed", "rejected"]);
export type DeliveryResponseStatus = z.infer<typeof DeliveryResponseStatusSchema>;

export const DeliveryResponseSchema = z.object({
	deliveryId: z.string().min(1),
	status: DeliveryResponseStatusSchema,
	error: z.string().optional(),
});
export type DeliveryResponse = z.infer<typeof DeliveryResponseSchema>;
