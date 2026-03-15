import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { type ServiceName, type ServiceTokenPayload, ServiceTokenPayloadSchema } from "./schemas";

export interface SignOptions {
	issuer: ServiceName;
	audience: ServiceName;
	secret: string;
	subject?: string;
	correlationId?: string;
	ttlSeconds?: number;
}

export interface VerifyOptions {
	token: string;
	audience: ServiceName;
	secrets: string[];
	clockToleranceSeconds?: number;
}

function encodeSecret(secret: string): Uint8Array {
	return new TextEncoder().encode(secret);
}

export async function signServiceToken(options: SignOptions): Promise<string> {
	const { issuer, audience, secret, subject, correlationId, ttlSeconds = 30 } = options;

	const now = Math.floor(Date.now() / 1000);
	const jwt = new SignJWT({
		cid: correlationId,
	})
		.setProtectedHeader({ alg: "HS256" })
		.setIssuer(issuer)
		.setAudience(audience)
		.setJti(randomUUID())
		.setIssuedAt(now)
		.setExpirationTime(now + ttlSeconds);

	if (subject) {
		jwt.setSubject(subject);
	}

	return jwt.sign(encodeSecret(secret));
}

export async function verifyServiceToken(options: VerifyOptions): Promise<ServiceTokenPayload> {
	const { token, audience, secrets, clockToleranceSeconds = 5 } = options;

	if (secrets.length === 0) {
		throw new Error("No secrets provided for token verification");
	}

	let lastError: unknown;
	for (const secret of secrets) {
		try {
			const { payload } = await jwtVerify(token, encodeSecret(secret), {
				audience,
				clockTolerance: clockToleranceSeconds,
			});

			return ServiceTokenPayloadSchema.parse({
				iss: payload.iss,
				aud: typeof payload.aud === "string" ? payload.aud : payload.aud?.[0],
				sub: payload.sub,
				cid: payload.cid,
				jti: payload.jti,
				iat: payload.iat,
				exp: payload.exp,
			});
		} catch (err) {
			lastError = err;
		}
	}

	throw lastError;
}
