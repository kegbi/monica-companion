import { z } from "zod/v4";

export const OnboardingStep = z.enum(["onboarding"]);
export type OnboardingStep = z.infer<typeof OnboardingStep>;

export const SetupTokenStatus = z.enum(["active", "consumed", "cancelled", "superseded"]);
export type SetupTokenStatus = z.infer<typeof SetupTokenStatus>;

export const SetupTokenAuditEvent = z.enum([
	"issued",
	"validated",
	"consumed",
	"expired_rejected",
	"replay_rejected",
	"cancelled",
	"superseded_by_reissue",
	"invalid_signature_rejected",
]);
export type SetupTokenAuditEvent = z.infer<typeof SetupTokenAuditEvent>;

export const IssueSetupTokenRequest = z.object({
	telegramUserId: z.string().min(1),
	step: OnboardingStep,
});
export type IssueSetupTokenRequest = z.infer<typeof IssueSetupTokenRequest>;

export const IssueSetupTokenResponse = z.object({
	setupUrl: z.string().url(),
	tokenId: z.string().uuid(),
	expiresAt: z.string(),
});
export type IssueSetupTokenResponse = z.infer<typeof IssueSetupTokenResponse>;

export const ValidateSetupTokenResponse = z.object({
	valid: z.boolean(),
	telegramUserId: z.string().optional(),
	step: z.string().optional(),
	expiresAt: z.string().optional(),
});
export type ValidateSetupTokenResponse = z.infer<typeof ValidateSetupTokenResponse>;

export const ConsumeSetupTokenRequest = z.object({
	sig: z.string().min(1),
});
export type ConsumeSetupTokenRequest = z.infer<typeof ConsumeSetupTokenRequest>;

export const OnboardingFields = z.object({
	monicaBaseUrl: z.string().url(),
	monicaApiKey: z.string().min(1),
	language: z.string().min(2).max(10).default("en"),
	confirmationMode: z.enum(["explicit", "auto"]).default("explicit"),
	timezone: z.string().min(1),
	reminderCadence: z.enum(["daily", "weekly", "none"]).default("daily"),
	reminderTime: z
		.string()
		.regex(/^\d{2}:\d{2}$/)
		.default("08:00"),
});
export type OnboardingFields = z.infer<typeof OnboardingFields>;

export const ConsumeSetupTokenWithOnboardingRequest =
	ConsumeSetupTokenRequest.merge(OnboardingFields);
export type ConsumeSetupTokenWithOnboardingRequest = z.infer<
	typeof ConsumeSetupTokenWithOnboardingRequest
>;

export const ConsumeSetupTokenResponse = z.object({
	consumed: z.boolean(),
	reason: z.string().optional(),
});
export type ConsumeSetupTokenResponse = z.infer<typeof ConsumeSetupTokenResponse>;

export const CancelSetupTokenResponse = z.object({
	cancelled: z.boolean(),
});
export type CancelSetupTokenResponse = z.infer<typeof CancelSetupTokenResponse>;
