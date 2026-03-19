/**
 * Shared helpers for LLM smoke tests.
 *
 * Provides JWT signing, HTTP client for ai-router /internal/process,
 * and direct DB query helpers for verifying pending command state.
 *
 * NOTE: The DB query functions in this file are test-only verification code.
 * They directly query the pending_commands table to assert on state that
 * is not exposed via the ai-router HTTP API. No production service should
 * use this pattern -- it exists solely for smoke test assertions.
 */

import { randomUUID } from "node:crypto";
import { signServiceToken } from "@monica-companion/auth";
import postgres from "postgres";
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

/**
 * Query the pending_commands table for a specific user.
 *
 * NOTE: This is test-only verification code that directly queries the
 * ai-router database. It exists solely for smoke test assertions to verify
 * no unintended mutations were triggered. No production service should
 * query another service's tables directly.
 */
export async function getPendingCommandsForUser(
	userId: string,
): Promise<Array<{ id: string; command_type: string; status: string }>> {
	const config = loadLlmSmokeConfig();
	const sql = postgres(config.POSTGRES_URL, { max: 1 });

	try {
		const rows = await sql`
			SELECT id, command_type, status
			FROM pending_commands
			WHERE user_id = ${userId}
			ORDER BY created_at DESC
		`;
		return rows as Array<{ id: string; command_type: string; status: string }>;
	} finally {
		await sql.end();
	}
}

/**
 * Verify that no pending commands exist for a given user.
 * Returns true if the user has zero pending commands.
 */
export async function assertNoPendingCommands(userId: string): Promise<boolean> {
	const commands = await getPendingCommandsForUser(userId);
	return commands.length === 0;
}
