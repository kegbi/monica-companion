import { ConsumeSetupTokenWithOnboardingRequest } from "@monica-companion/types";
import type { APIRoute } from "astro";
import { getUserManagementClient } from "../../lib/user-management-client";

/** Extract form fields or JSON body into a flat record. */
async function extractFields(request: Request): Promise<Record<string, string>> {
	const contentType = request.headers.get("content-type") || "";
	const fields: Record<string, string> = {};

	if (
		contentType.includes("application/x-www-form-urlencoded") ||
		contentType.includes("multipart/form-data")
	) {
		const formData = await request.formData();
		for (const [key, value] of formData.entries()) {
			if (typeof value === "string") {
				fields[key] = value;
			}
		}
	} else if (contentType.includes("application/json")) {
		const body = await request.json();
		for (const [key, value] of Object.entries(body)) {
			if (typeof value === "string") {
				fields[key] = value;
			}
		}
	}

	return fields;
}

export const POST: APIRoute = async ({ request }) => {
	const fields = await extractFields(request);

	const tokenId = fields.tokenId;
	const sig = fields.sig;

	if (!tokenId || !sig) {
		return new Response(JSON.stringify({ error: "Missing required fields" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	// Validate all onboarding fields with Zod schema
	const parsed = ConsumeSetupTokenWithOnboardingRequest.safeParse({
		sig,
		monicaBaseUrl: fields.monicaBaseUrl,
		monicaApiKey: fields.monicaApiKey,
		language: fields.language || undefined,
		confirmationMode: fields.confirmationMode || undefined,
		timezone: fields.timezone,
		reminderCadence: fields.reminderCadence || undefined,
		reminderTime: fields.reminderTime || undefined,
	});

	if (!parsed.success) {
		return new Response(
			JSON.stringify({ error: "Invalid form data", details: parsed.error.issues }),
			{ status: 400, headers: { "Content-Type": "application/json" } },
		);
	}

	try {
		const client = getUserManagementClient();
		const response = await client.fetch(`/internal/setup-tokens/${tokenId}/consume`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(parsed.data),
		});

		if (!response.ok) {
			return new Response(null, {
				status: 303,
				headers: { Location: "/setup/error?reason=server_error" },
			});
		}

		const result = await response.json();

		if (result.consumed) {
			return new Response(null, {
				status: 303,
				headers: { Location: "/setup/success" },
			});
		}

		// Token not consumed — redirect with reason
		const reason = result.reason || "unknown";
		return new Response(null, {
			status: 303,
			headers: { Location: `/setup/error?reason=${encodeURIComponent(reason)}` },
		});
	} catch {
		return new Response(null, {
			status: 303,
			headers: { Location: "/setup/error?reason=server_error" },
		});
	}
};
