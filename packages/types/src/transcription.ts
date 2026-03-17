import { z } from "zod/v4";

export const TranscriptionRequestMetadataSchema = z.object({
	mimeType: z.string().min(1),
	durationSeconds: z.number().positive(),
	languageHint: z.string().optional(),
	correlationId: z.string().min(1),
});

export type TranscriptionRequestMetadata = z.infer<typeof TranscriptionRequestMetadataSchema>;

export const TranscriptionResponseSchema = z.object({
	success: z.boolean(),
	text: z.string().optional(),
	error: z.string().optional(),
	correlationId: z.string().min(1),
});

export type TranscriptionResponse = z.infer<typeof TranscriptionResponseSchema>;
