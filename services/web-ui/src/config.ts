import { z } from "zod/v4";

const configSchema = z.object({
	USER_MANAGEMENT_URL: z.string().min(1),
	JWT_SECRET: z.string().min(1),
	JWT_SECRET_PREVIOUS: z.string().optional(),
	EXPECTED_ORIGIN: z.string().min(1),
	SERVICE_NAME: z.string().min(1).default("web-ui"),
});

export interface WebUiConfig {
	userManagementUrl: string;
	jwtSecret: string;
	jwtSecretPrevious?: string;
	expectedOrigin: string;
	serviceName: string;
}

export function loadWebUiConfig(
	env: Record<string, string | undefined> = process.env,
): WebUiConfig {
	const parsed = configSchema.parse(env);
	return {
		userManagementUrl: parsed.USER_MANAGEMENT_URL,
		jwtSecret: parsed.JWT_SECRET,
		jwtSecretPrevious: parsed.JWT_SECRET_PREVIOUS,
		expectedOrigin: parsed.EXPECTED_ORIGIN,
		serviceName: parsed.SERVICE_NAME,
	};
}
