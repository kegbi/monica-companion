import { describe, expect, it } from "vitest";
import { signServiceToken, verifyServiceToken } from "../token";

const SECRET = "test-secret-256-bit-minimum-key!";
const SECRET_OLD = "old-secret-256-bit-minimum-key!!";

describe("signServiceToken", () => {
	it("returns a signed JWT string", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
		});
		expect(typeof token).toBe("string");
		expect(token.split(".")).toHaveLength(3);
	});

	it("includes optional subject and correlationId", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
			subject: "user-123",
			correlationId: "corr-456",
		});
		const payload = await verifyServiceToken({
			token,
			audience: "ai-router",
			secrets: [SECRET],
		});
		expect(payload.sub).toBe("user-123");
		expect(payload.cid).toBe("corr-456");
	});

	it("uses 30s TTL by default", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
		});
		const payload = await verifyServiceToken({
			token,
			audience: "ai-router",
			secrets: [SECRET],
		});
		expect(payload.exp - payload.iat).toBe(30);
	});

	it("respects custom TTL", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
			ttlSeconds: 60,
		});
		const payload = await verifyServiceToken({
			token,
			audience: "ai-router",
			secrets: [SECRET],
		});
		expect(payload.exp - payload.iat).toBe(60);
	});

	it("generates unique jti for each token", async () => {
		const token1 = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
		});
		const token2 = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
		});
		const payload1 = await verifyServiceToken({
			token: token1,
			audience: "ai-router",
			secrets: [SECRET],
		});
		const payload2 = await verifyServiceToken({
			token: token2,
			audience: "ai-router",
			secrets: [SECRET],
		});
		expect(payload1.jti).not.toBe(payload2.jti);
	});
});

describe("verifyServiceToken", () => {
	it("verifies a valid token", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
		});
		const payload = await verifyServiceToken({
			token,
			audience: "ai-router",
			secrets: [SECRET],
		});
		expect(payload.iss).toBe("telegram-bridge");
		expect(payload.aud).toBe("ai-router");
		expect(payload.jti).toBeDefined();
	});

	it("rejects token with wrong secret", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
		});
		await expect(
			verifyServiceToken({
				token,
				audience: "ai-router",
				secrets: ["wrong-secret-that-is-long-enough"],
			}),
		).rejects.toThrow();
	});

	it("rejects token with wrong audience", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
		});
		await expect(
			verifyServiceToken({
				token,
				audience: "scheduler",
				secrets: [SECRET],
			}),
		).rejects.toThrow();
	});

	it("rejects expired token", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
			ttlSeconds: -10,
		});
		await expect(
			verifyServiceToken({
				token,
				audience: "ai-router",
				secrets: [SECRET],
				clockToleranceSeconds: 0,
			}),
		).rejects.toThrow();
	});

	it("accepts token signed with previous secret (rotation)", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET_OLD,
		});
		const payload = await verifyServiceToken({
			token,
			audience: "ai-router",
			secrets: [SECRET, SECRET_OLD],
		});
		expect(payload.iss).toBe("telegram-bridge");
	});

	it("tries current secret first, falls back to previous", async () => {
		const token = await signServiceToken({
			issuer: "scheduler",
			audience: "delivery",
			secret: SECRET,
		});
		const payload = await verifyServiceToken({
			token,
			audience: "delivery",
			secrets: [SECRET, SECRET_OLD],
		});
		expect(payload.iss).toBe("scheduler");
	});

	it("rejects completely invalid token string", async () => {
		await expect(
			verifyServiceToken({
				token: "not.a.jwt",
				audience: "ai-router",
				secrets: [SECRET],
			}),
		).rejects.toThrow();
	});

	it("rejects token with no secrets provided", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "ai-router",
			secret: SECRET,
		});
		await expect(
			verifyServiceToken({
				token,
				audience: "ai-router",
				secrets: [],
			}),
		).rejects.toThrow();
	});
});
