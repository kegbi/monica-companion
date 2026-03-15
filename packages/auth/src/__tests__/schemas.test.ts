import { describe, expect, it } from "vitest";
import {
	type AuthConfig,
	loadAuthConfig,
	SERVICE_NAMES,
	ServiceNameSchema,
	ServiceTokenPayloadSchema,
} from "../schemas";

describe("ServiceNameSchema", () => {
	it("accepts all valid service names", () => {
		for (const name of SERVICE_NAMES) {
			expect(ServiceNameSchema.parse(name)).toBe(name);
		}
	});

	it("rejects unknown service names", () => {
		expect(() => ServiceNameSchema.parse("unknown-service")).toThrow();
	});

	it("contains exactly 8 services", () => {
		expect(SERVICE_NAMES).toHaveLength(8);
	});
});

describe("ServiceTokenPayloadSchema", () => {
	it("accepts a valid full payload", () => {
		const payload = {
			iss: "telegram-bridge",
			aud: "ai-router",
			sub: "user-123",
			cid: "corr-456",
			jti: "token-789",
			iat: 1000,
			exp: 1030,
		};
		expect(ServiceTokenPayloadSchema.parse(payload)).toEqual(payload);
	});

	it("accepts payload without optional fields", () => {
		const payload = {
			iss: "telegram-bridge",
			aud: "ai-router",
			jti: "token-789",
			iat: 1000,
			exp: 1030,
		};
		const parsed = ServiceTokenPayloadSchema.parse(payload);
		expect(parsed.sub).toBeUndefined();
		expect(parsed.cid).toBeUndefined();
	});

	it("rejects payload with invalid issuer", () => {
		const payload = {
			iss: "not-a-service",
			aud: "ai-router",
			jti: "token-789",
			iat: 1000,
			exp: 1030,
		};
		expect(() => ServiceTokenPayloadSchema.parse(payload)).toThrow();
	});

	it("rejects payload with invalid audience", () => {
		const payload = {
			iss: "telegram-bridge",
			aud: "not-a-service",
			jti: "token-789",
			iat: 1000,
			exp: 1030,
		};
		expect(() => ServiceTokenPayloadSchema.parse(payload)).toThrow();
	});

	it("rejects payload missing required fields", () => {
		expect(() => ServiceTokenPayloadSchema.parse({})).toThrow();
		expect(() => ServiceTokenPayloadSchema.parse({ iss: "telegram-bridge" })).toThrow();
	});
});

describe("loadAuthConfig", () => {
	it("parses valid environment", () => {
		const env = {
			SERVICE_NAME: "telegram-bridge",
			JWT_SECRET: "my-secret-key",
		};
		const config = loadAuthConfig(env);
		expect(config.serviceName).toBe("telegram-bridge");
		expect(config.jwtSecrets).toEqual(["my-secret-key"]);
	});

	it("includes previous secret when provided", () => {
		const env = {
			SERVICE_NAME: "ai-router",
			JWT_SECRET: "new-secret",
			JWT_SECRET_PREVIOUS: "old-secret",
		};
		const config = loadAuthConfig(env);
		expect(config.jwtSecrets).toEqual(["new-secret", "old-secret"]);
	});

	it("excludes previous secret when empty string", () => {
		const env = {
			SERVICE_NAME: "scheduler",
			JWT_SECRET: "my-secret",
			JWT_SECRET_PREVIOUS: "",
		};
		const config = loadAuthConfig(env);
		expect(config.jwtSecrets).toEqual(["my-secret"]);
	});

	it("excludes previous secret when undefined", () => {
		const env = {
			SERVICE_NAME: "delivery",
			JWT_SECRET: "my-secret",
		};
		const config = loadAuthConfig(env);
		expect(config.jwtSecrets).toEqual(["my-secret"]);
	});

	it("throws for missing SERVICE_NAME", () => {
		expect(() => loadAuthConfig({ JWT_SECRET: "secret" })).toThrow();
	});

	it("throws for invalid SERVICE_NAME", () => {
		expect(() => loadAuthConfig({ SERVICE_NAME: "bad", JWT_SECRET: "secret" })).toThrow();
	});

	it("throws for missing JWT_SECRET", () => {
		expect(() => loadAuthConfig({ SERVICE_NAME: "telegram-bridge" })).toThrow();
	});

	it("throws for empty JWT_SECRET", () => {
		expect(() => loadAuthConfig({ SERVICE_NAME: "telegram-bridge", JWT_SECRET: "" })).toThrow();
	});

	it("returns correct AuthConfig shape", () => {
		const config: AuthConfig = loadAuthConfig({
			SERVICE_NAME: "web-ui",
			JWT_SECRET: "key",
		});
		expect(config).toHaveProperty("serviceName");
		expect(config).toHaveProperty("jwtSecrets");
	});
});
