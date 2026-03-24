/**
 * Shared helpers for LLM smoke tests.
 *
 * Provides JWT signing and HTTP client for ai-router /internal/process.
 */

import { randomUUID } from "node:crypto";
import { signServiceToken } from "@monica-companion/auth";
import { loadLlmSmokeConfig } from "./smoke-config.js";

interface GraphResponse {
	type: "text" | "confirmation_prompt" | "disambiguation_prompt" | "error";
	text: string;
	pendingCommandId?: string;
	version?: number;
	options?: Array<{ label: string; value: string }>;
}

interface SendMessageResult {
	status: number;
	body: GraphResponse;
}

/**
 * Signs a service JWT for smoke test requests.
 * Defaults: issuer=telegram-bridge (the legitimate caller of ai-router /internal/process),
 * audience=ai-router, subject=provided userId, ttl=60s.
 */
async function signToken(userId: string): Promise<string> {
	const config = loadLlmSmokeConfig();
	return signServiceToken({
		issuer: "telegram-bridge",
		audience: "ai-router",
		secret: config.JWT_SECRET,
		subject: userId,
		ttlSeconds: 60,
	});
}

/**
 * Send a text message to ai-router /internal/process and return the parsed response.
 *
 * Each call creates a fresh correlationId unless one is provided.
 * The timeout is extended to 45 seconds to accommodate LLM response times.
 */
export async function sendMessage(
	userId: string,
	text: string,
	correlationId?: string,
): Promise<SendMessageResult> {
	const config = loadLlmSmokeConfig();
	const token = await signToken(userId);
	const cid = correlationId ?? randomUUID();

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 45_000);

	try {
		const res = await fetch(`${config.AI_ROUTER_URL}/internal/process`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				type: "text_message",
				userId,
				sourceRef: `smoke:${cid}`,
				correlationId: cid,
				text,
			}),
			signal: controller.signal,
		});

		const body = (await res.json()) as GraphResponse;
		return { status: res.status, body };
	} finally {
		clearTimeout(timer);
	}
}
