import { randomBytes, timingSafeEqual } from "node:crypto";

export function generateCsrfToken(): string {
	return randomBytes(32).toString("hex");
}

export function getCsrfCookieName(isSecure: boolean): string {
	return isSecure ? "__Host-csrf" : "csrf";
}

export function buildCsrfCookieHeader(token: string, isSecure: boolean): string {
	const name = getCsrfCookieName(isSecure);
	// __Host- prefix requires Path=/ per RFC 6265bis section 4.1.3
	const path = isSecure ? "/" : "/setup";
	const parts = [`${name}=${token}`, "HttpOnly", "SameSite=Strict", `Path=${path}`];
	if (isSecure) {
		parts.push("Secure");
	}
	return parts.join("; ");
}

export function validateCsrfToken(
	cookieValue: string | undefined,
	formValue: string | undefined,
): boolean {
	if (!cookieValue || !formValue) {
		return false;
	}

	const cookieBuffer = Buffer.from(cookieValue);
	const formBuffer = Buffer.from(formValue);

	if (cookieBuffer.length !== formBuffer.length) {
		return false;
	}

	return timingSafeEqual(cookieBuffer, formBuffer);
}

export function validateOrigin(origin: string | null | undefined, expectedOrigin: string): boolean {
	if (!origin) {
		return false;
	}

	const normalize = (url: string) => url.replace(/\/+$/, "");
	return normalize(origin) === normalize(expectedOrigin);
}
