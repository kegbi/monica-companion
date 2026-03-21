import { defineMiddleware } from "astro:middleware";
import {
	buildCsrfCookieHeader,
	generateCsrfToken,
	getCsrfCookieName,
	validateCsrfToken,
	validateOrigin,
} from "./lib/csrf";

function parseCookies(cookieHeader: string | null): Record<string, string> {
	if (!cookieHeader) return {};
	const cookies: Record<string, string> = {};
	for (const pair of cookieHeader.split(";")) {
		const [key, ...rest] = pair.trim().split("=");
		if (key) {
			cookies[key.trim()] = rest.join("=").trim();
		}
	}
	return cookies;
}

export const onRequest = defineMiddleware(async (context, next) => {
	const { url, request } = context;

	// Only apply to /setup/* routes
	if (!url.pathname.startsWith("/setup")) {
		return next();
	}

	const isSecure = url.protocol === "https:";
	const cookieName = getCsrfCookieName(isSecure);
	const expectedOrigin =
		import.meta.env.EXPECTED_ORIGIN ||
		process.env.EXPECTED_ORIGIN ||
		`${url.protocol}//${url.host}`;

	if (request.method === "GET") {
		const csrfToken = generateCsrfToken();
		context.locals.csrfToken = csrfToken;
		const response = await next();
		response.headers.append("Set-Cookie", buildCsrfCookieHeader(csrfToken, isSecure));
		return response;
	}

	if (request.method === "POST") {
		// Validate Origin header
		const origin = request.headers.get("origin");
		if (!validateOrigin(origin, expectedOrigin)) {
			return new Response(JSON.stringify({ error: "Origin mismatch" }), {
				status: 403,
				headers: { "Content-Type": "application/json" },
			});
		}

		// Validate CSRF token
		const cookies = parseCookies(request.headers.get("cookie"));
		const cookieCsrf = cookies[cookieName];

		let formCsrf: string | undefined;
		const contentType = request.headers.get("content-type") || "";

		if (
			contentType.includes("application/x-www-form-urlencoded") ||
			contentType.includes("multipart/form-data")
		) {
			const formData = await request.clone().formData();
			formCsrf = formData.get("csrf_token")?.toString();
		} else if (contentType.includes("application/json")) {
			const body = await request.clone().json();
			formCsrf = body.csrf_token;
		}

		if (!validateCsrfToken(cookieCsrf, formCsrf)) {
			return new Response(JSON.stringify({ error: "CSRF validation failed" }), {
				status: 403,
				headers: { "Content-Type": "application/json" },
			});
		}

		return next();
	}

	return next();
});
