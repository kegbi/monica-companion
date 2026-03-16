import { z } from "zod/v4";

export const telemetryConfigSchema = z.object({
	serviceName: z.string().min(1),
	otlpEndpoint: z.string().optional(),
	enabled: z.boolean().optional().default(true),
	logLevel: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),
});

export type TelemetryConfig = z.infer<typeof telemetryConfigSchema>;
