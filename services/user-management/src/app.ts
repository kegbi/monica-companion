import { randomUUID } from "node:crypto";
import {
	correlationId,
	getCorrelationId,
	getServiceCaller,
	serviceAuth,
} from "@monica-companion/auth";
import { createLogger, otelMiddleware } from "@monica-companion/observability";
import { ConsumeSetupTokenRequest, IssueSetupTokenRequest } from "@monica-companion/types";
import { Hono } from "hono";
import type { Config } from "./config";
import type { Database } from "./db/connection";

const logger = createLogger("user-management");

import { buildSetupUrl, generateSetupToken, verifySetupTokenSignature } from "./setup-token/crypto";
import {
	cancelToken,
	consumeToken,
	findTokenById,
	issueToken,
	logAuditEvent,
} from "./setup-token/repository";

export function createApp(config: Config, db: Database) {
	const app = new Hono();

	app.use(otelMiddleware());

	app.get("/health", correlationId(), (c) => c.json({ status: "ok", service: "user-management" }));

	const telegramBridgeAuth = serviceAuth({
		audience: "user-management",
		secrets: config.auth.jwtSecrets,
		allowedCallers: ["telegram-bridge"],
	});

	const webUiAuth = serviceAuth({
		audience: "user-management",
		secrets: config.auth.jwtSecrets,
		allowedCallers: ["web-ui"],
	});

	// --- Issue token endpoint (caller: telegram-bridge) ---
	app.post("/internal/setup-tokens", telegramBridgeAuth, async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}
		const parsed = IssueSetupTokenRequest.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const { telegramUserId, step } = parsed.data;
		const tokenId = randomUUID();
		const expiresAt = new Date(Date.now() + config.setupTokenTtlMinutes * 60 * 1000);
		const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);

		const signature = generateSetupToken({
			tokenId,
			telegramUserId,
			step,
			expiresAtUnix,
			secret: config.setupTokenSecret,
		});

		const cid = getCorrelationId(c);
		const actorService = getServiceCaller(c);

		await issueToken(db, {
			tokenId,
			telegramUserId,
			step,
			expiresAt,
			correlationId: cid,
			actorService,
		});

		const setupUrl = buildSetupUrl({
			baseUrl: config.setupBaseUrl,
			tokenId,
			signature,
		});

		return c.json(
			{
				setupUrl,
				tokenId,
				expiresAt: expiresAt.toISOString(),
			},
			201,
		);
	});

	// --- Validate token endpoint (caller: web-ui) ---
	app.get("/internal/setup-tokens/:tokenId/validate", webUiAuth, async (c) => {
		const tokenId = c.req.param("tokenId");
		const sig = c.req.query("sig");

		if (!sig) {
			return c.json({ valid: false }, 400);
		}

		const cid = getCorrelationId(c);
		const actorService = getServiceCaller(c);

		const token = await findTokenById(db, tokenId);
		if (!token) {
			return c.json({ valid: false });
		}

		const expiresAtUnix = Math.floor(token.expiresAt.getTime() / 1000);

		// Verify HMAC signature
		const signatureValid = verifySetupTokenSignature({
			tokenId,
			telegramUserId: token.telegramUserId,
			step: token.step,
			expiresAtUnix,
			signature: sig,
			secret: config.setupTokenSecret,
		});

		if (!signatureValid) {
			await logAuditEvent(db, {
				tokenId,
				event: "invalid_signature_rejected",
				actorService,
				correlationId: cid,
			});
			return c.json({ error: "Invalid signature" }, 403);
		}

		// Check token status
		if (token.status !== "active") {
			if (token.status === "consumed") {
				await logAuditEvent(db, {
					tokenId,
					event: "replay_rejected",
					actorService,
					correlationId: cid,
				});
			}
			return c.json({ valid: false });
		}

		// Check expiry
		if (token.expiresAt <= new Date()) {
			await logAuditEvent(db, {
				tokenId,
				event: "expired_rejected",
				actorService,
				correlationId: cid,
			});
			return c.json({ valid: false });
		}

		await logAuditEvent(db, {
			tokenId,
			event: "validated",
			actorService,
			correlationId: cid,
		});

		return c.json({
			valid: true,
			telegramUserId: token.telegramUserId,
			step: token.step,
			expiresAt: token.expiresAt.toISOString(),
		});
	});

	// --- Consume token endpoint (caller: web-ui) ---
	app.post("/internal/setup-tokens/:tokenId/consume", webUiAuth, async (c) => {
		const tokenId = c.req.param("tokenId");
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid request body" }, 400);
		}
		const parsed = ConsumeSetupTokenRequest.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid request body" }, 400);
		}

		const { sig } = parsed.data;
		const cid = getCorrelationId(c);
		const actorService = getServiceCaller(c);

		// Look up the token to verify the signature
		const token = await findTokenById(db, tokenId);
		if (!token) {
			return c.json({ consumed: false, reason: "not_found" });
		}

		const expiresAtUnix = Math.floor(token.expiresAt.getTime() / 1000);

		const signatureValid = verifySetupTokenSignature({
			tokenId,
			telegramUserId: token.telegramUserId,
			step: token.step,
			expiresAtUnix,
			signature: sig,
			secret: config.setupTokenSecret,
		});

		if (!signatureValid) {
			await logAuditEvent(db, {
				tokenId,
				event: "invalid_signature_rejected",
				actorService,
				correlationId: cid,
			});
			return c.json({ error: "Invalid signature" }, 403);
		}

		const result = await consumeToken(db, {
			tokenId,
			actorService,
			correlationId: cid,
		});

		return c.json(result);
	});

	// --- Cancel token endpoint (caller: telegram-bridge) ---
	app.post("/internal/setup-tokens/:tokenId/cancel", telegramBridgeAuth, async (c) => {
		const tokenId = c.req.param("tokenId");
		const cid = getCorrelationId(c);
		const actorService = getServiceCaller(c);

		// Look up the token to get the telegramUserId
		const token = await findTokenById(db, tokenId);
		if (!token) {
			return c.json({ cancelled: false });
		}

		const result = await cancelToken(db, {
			telegramUserId: token.telegramUserId,
			actorService,
			correlationId: cid,
		});

		return c.json(result);
	});

	// --- Stub credential endpoint (smoke testing only) ---
	// TODO: Replace with real encrypted credential resolution (Least-Privilege User Management)
	if (process.env.NODE_ENV !== "production") {
		const monicaIntegrationAuth = serviceAuth({
			audience: "user-management",
			secrets: config.auth.jwtSecrets,
			allowedCallers: ["monica-integration"],
		});

		logger.warn("Stub credential endpoint is active. This must NOT be used in production.");

		app.get("/internal/users/:userId/monica-credentials", monicaIntegrationAuth, (c) => {
			const baseUrl = process.env.MONICA_BASE_URL;
			const apiToken = process.env.MONICA_API_TOKEN;

			if (!baseUrl || !apiToken) {
				return c.json({ error: "Monica credentials not configured" }, 404);
			}

			return c.json({ baseUrl, apiToken });
		});
	}

	return app;
}
