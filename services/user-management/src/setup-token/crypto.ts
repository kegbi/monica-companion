import { createHmac, timingSafeEqual } from "node:crypto";

export interface GenerateSetupTokenParams {
	tokenId: string;
	telegramUserId: string;
	step: string;
	expiresAtUnix: number;
	secret: string;
}

export interface VerifySetupTokenSignatureParams {
	tokenId: string;
	telegramUserId: string;
	step: string;
	expiresAtUnix: number;
	signature: string;
	secret: string;
}

export interface BuildSetupUrlParams {
	baseUrl: string;
	tokenId: string;
	signature: string;
}

function computeHmac(data: string, secret: string): Buffer {
	return createHmac("sha256", secret).update(data).digest();
}

function toUrlSafeBase64(buffer: Buffer): string {
	return buffer.toString("base64url");
}

function buildSignatureData(params: {
	tokenId: string;
	telegramUserId: string;
	step: string;
	expiresAtUnix: number;
}): string {
	return `${params.tokenId}:${params.telegramUserId}:${params.step}:${params.expiresAtUnix}`;
}

export function generateSetupToken(params: GenerateSetupTokenParams): string {
	const data = buildSignatureData(params);
	const hmac = computeHmac(data, params.secret);
	return toUrlSafeBase64(hmac);
}

export function verifySetupTokenSignature(params: VerifySetupTokenSignatureParams): boolean {
	const data = buildSignatureData(params);
	const expected = computeHmac(data, params.secret);

	let provided: Buffer;
	try {
		provided = Buffer.from(params.signature, "base64url");
	} catch {
		return false;
	}

	if (expected.length !== provided.length) {
		return false;
	}

	return timingSafeEqual(expected, provided);
}

export function buildSetupUrl(params: BuildSetupUrlParams): string {
	const base = params.baseUrl.replace(/\/+$/, "");
	return `${base}/setup/${params.tokenId}?sig=${params.signature}`;
}
