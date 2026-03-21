import { describe, expect, it } from "vitest";
import {
	ConsumeSetupTokenRequest,
	ConsumeSetupTokenWithOnboardingRequest,
	OnboardingFields,
} from "../setup-token.js";

describe("OnboardingFields", () => {
	it("accepts a valid full set of onboarding fields", () => {
		const result = OnboardingFields.safeParse({
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "some-api-key-123",
			language: "en",
			confirmationMode: "explicit",
			timezone: "America/New_York",
			reminderCadence: "daily",
			reminderTime: "08:00",
		});
		expect(result.success).toBe(true);
	});

	it("applies defaults for optional fields", () => {
		const result = OnboardingFields.safeParse({
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "some-key",
			timezone: "Europe/Berlin",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.language).toBe("en");
			expect(result.data.confirmationMode).toBe("explicit");
			expect(result.data.reminderCadence).toBe("daily");
			expect(result.data.reminderTime).toBe("08:00");
		}
	});

	it("rejects missing monicaBaseUrl", () => {
		const result = OnboardingFields.safeParse({
			monicaApiKey: "some-key",
			timezone: "UTC",
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid monicaBaseUrl (not a URL)", () => {
		const result = OnboardingFields.safeParse({
			monicaBaseUrl: "not-a-url",
			monicaApiKey: "some-key",
			timezone: "UTC",
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty monicaApiKey", () => {
		const result = OnboardingFields.safeParse({
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "",
			timezone: "UTC",
		});
		expect(result.success).toBe(false);
	});

	it("rejects missing timezone", () => {
		const result = OnboardingFields.safeParse({
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "some-key",
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid confirmationMode", () => {
		const result = OnboardingFields.safeParse({
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "some-key",
			timezone: "UTC",
			confirmationMode: "invalid",
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid reminderCadence", () => {
		const result = OnboardingFields.safeParse({
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "some-key",
			timezone: "UTC",
			reminderCadence: "monthly",
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid reminderTime format", () => {
		const result = OnboardingFields.safeParse({
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "some-key",
			timezone: "UTC",
			reminderTime: "8am",
		});
		expect(result.success).toBe(false);
	});

	it("accepts valid reminderTime format HH:MM", () => {
		const result = OnboardingFields.safeParse({
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "key",
			timezone: "UTC",
			reminderTime: "14:30",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.reminderTime).toBe("14:30");
		}
	});
});

describe("ConsumeSetupTokenWithOnboardingRequest", () => {
	it("accepts a valid full payload with sig and all onboarding fields", () => {
		const result = ConsumeSetupTokenWithOnboardingRequest.safeParse({
			sig: "some-signature",
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "some-api-key-123",
			language: "en",
			confirmationMode: "explicit",
			timezone: "America/New_York",
			reminderCadence: "daily",
			reminderTime: "08:00",
		});
		expect(result.success).toBe(true);
	});

	it("requires sig from ConsumeSetupTokenRequest", () => {
		const result = ConsumeSetupTokenWithOnboardingRequest.safeParse({
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "some-key",
			timezone: "UTC",
		});
		expect(result.success).toBe(false);
	});

	it("requires onboarding fields alongside sig", () => {
		const result = ConsumeSetupTokenWithOnboardingRequest.safeParse({
			sig: "some-signature",
		});
		// Should fail because monicaBaseUrl, monicaApiKey, timezone are required
		expect(result.success).toBe(false);
	});

	it("applies defaults for optional onboarding fields", () => {
		const result = ConsumeSetupTokenWithOnboardingRequest.safeParse({
			sig: "some-signature",
			monicaBaseUrl: "https://app.monicahq.com",
			monicaApiKey: "key",
			timezone: "Europe/London",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.sig).toBe("some-signature");
			expect(result.data.language).toBe("en");
			expect(result.data.confirmationMode).toBe("explicit");
			expect(result.data.reminderCadence).toBe("daily");
			expect(result.data.reminderTime).toBe("08:00");
		}
	});

	it("does not break existing ConsumeSetupTokenRequest (backward compat)", () => {
		const result = ConsumeSetupTokenRequest.safeParse({ sig: "test" });
		expect(result.success).toBe(true);
	});
});
