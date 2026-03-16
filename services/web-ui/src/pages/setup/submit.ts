import type { APIRoute } from "astro";
import { getUserManagementClient } from "../../lib/user-management-client";

export const POST: APIRoute = async ({ request }) => {
	const contentType = request.headers.get("content-type") || "";

	let tokenId: string | undefined;
	let sig: string | undefined;

	if (
		contentType.includes("application/x-www-form-urlencoded") ||
		contentType.includes("multipart/form-data")
	) {
		const formData = await request.formData();
		tokenId = formData.get("tokenId")?.toString();
		sig = formData.get("sig")?.toString();
	} else if (contentType.includes("application/json")) {
		const body = await request.json();
		tokenId = body.tokenId;
		sig = body.sig;
	}

	if (!tokenId || !sig) {
		return new Response(JSON.stringify({ error: "Missing required fields" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	try {
		const client = getUserManagementClient();
		const response = await client.fetch(`/internal/setup-tokens/${tokenId}/consume`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sig }),
		});

		if (!response.ok) {
			return new Response(
				JSON.stringify({
					error: "Unable to complete setup. Please try again or request a new setup link.",
				}),
				{
					status: response.status,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		const result = await response.json();

		if (result.consumed) {
			return new Response(
				JSON.stringify({ success: true, message: "Setup completed successfully" }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}

		return new Response(
			JSON.stringify({
				error:
					"This setup link has already been used or has expired. Please return to Telegram to request a new setup link.",
				reason: result.reason,
			}),
			{ status: 400, headers: { "Content-Type": "application/json" } },
		);
	} catch {
		return new Response(
			JSON.stringify({ error: "Unable to complete setup at this time. Please try again later." }),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
};
