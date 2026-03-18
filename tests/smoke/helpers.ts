/**
 * Shared helpers for stack smoke tests.
 *
 * Provides JWT token generation and a typed HTTP client for
 * making authenticated service-to-service requests.
 */

import { randomUUID } from "node:crypto";
import type { ServiceName } from "@monica-companion/auth";
import { signServiceToken } from "@monica-companion/auth";
import { loadSmokeConfig } from "./smoke-config.js";

/**
 * Signs a service JWT for smoke test requests.
 * Defaults: issuer=telegram-bridge, audience=target service,
 * subject=random userId, ttl=60s.
 */
export async function signToken(opts: {
	audience: ServiceName;
	issuer?: ServiceName;
	userId?: string;
}): Promise<string> {
	const config = loadSmokeConfig();
	return signServiceToken({
		issuer: opts.issuer ?? "telegram-bridge",
		audience: opts.audience,
		secret: config.JWT_SECRET,
		subject: opts.userId ?? randomUUID(),
		ttlSeconds: 60,
	});
}

interface FetchOpts {
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
	timeout?: number;
}

/**
 * Fetch wrapper with JSON defaults, timeout, and error context.
 */
export async function smokeRequest(
	url: string,
	opts: FetchOpts = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeout ?? 10_000);

	const headers: Record<string, string> = {
		"content-type": "application/json",
		...opts.headers,
	};

	try {
		const res = await fetch(url, {
			method: opts.method ?? "GET",
			headers,
			body: opts.body ? JSON.stringify(opts.body) : undefined,
			signal: controller.signal,
		});
		let body: unknown;
		const ct = res.headers.get("content-type") ?? "";
		if (ct.includes("json")) {
			body = await res.json();
		} else {
			body = await res.text();
		}
		return { status: res.status, body, headers: res.headers };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Fetch with an authenticated JWT header.
 */
export async function authedRequest(
	url: string,
	audience: ServiceName,
	opts: FetchOpts & { userId?: string; issuer?: ServiceName } = {},
): Promise<{ status: number; body: unknown; headers: Headers }> {
	const token = await signToken({
		audience,
		issuer: opts.issuer,
		userId: opts.userId,
	});
	return smokeRequest(url, {
		...opts,
		headers: {
			...opts.headers,
			authorization: `Bearer ${token}`,
		},
	});
}
