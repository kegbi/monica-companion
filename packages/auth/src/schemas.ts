import { z } from "zod/v4";

export const SERVICE_NAMES = [
	"telegram-bridge",
	"ai-router",
	"voice-transcription",
	"monica-integration",
	"scheduler",
	"delivery",
	"user-management",
	"web-ui",
] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

export const ServiceNameSchema = z.enum(SERVICE_NAMES);

export const ServiceTokenPayloadSchema = z.object({
	iss: ServiceNameSchema,
	aud: ServiceNameSchema,
	sub: z.string().optional(),
	cid: z.string().optional(),
	jti: z.string(),
	iat: z.number(),
	exp: z.number(),
});

export type ServiceTokenPayload = z.infer<typeof ServiceTokenPayloadSchema>;

const authConfigSchema = z.object({
	SERVICE_NAME: ServiceNameSchema,
	JWT_SECRET: z.string().min(1),
	JWT_SECRET_PREVIOUS: z.string().optional(),
});

export interface AuthConfig {
	serviceName: ServiceName;
	jwtSecrets: string[];
}

export function loadAuthConfig(env: Record<string, string | undefined>): AuthConfig {
	const parsed = authConfigSchema.parse(env);
	const jwtSecrets = [parsed.JWT_SECRET];
	if (parsed.JWT_SECRET_PREVIOUS) {
		jwtSecrets.push(parsed.JWT_SECRET_PREVIOUS);
	}
	return {
		serviceName: parsed.SERVICE_NAME,
		jwtSecrets,
	};
}
