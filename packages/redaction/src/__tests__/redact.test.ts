import { describe, expect, it } from "vitest";
import { redactObject, redactString, redactValue } from "../redact";

describe("redactValue", () => {
	describe("field-name based redaction", () => {
		it("redacts authorization header values", () => {
			expect(redactValue("authorization", "Bearer abc123")).toBe("[REDACTED]");
		});

		it("redacts Authorization (case-insensitive)", () => {
			expect(redactValue("Authorization", "Bearer abc123")).toBe("[REDACTED]");
		});

		it("redacts api_key fields", () => {
			expect(redactValue("api_key", "some-key-value")).toBe("[REDACTED]");
		});

		it("redacts apikey fields", () => {
			expect(redactValue("apikey", "some-key-value")).toBe("[REDACTED]");
		});

		it("redacts api-key fields", () => {
			expect(redactValue("api-key", "some-key-value")).toBe("[REDACTED]");
		});

		it("redacts password fields", () => {
			expect(redactValue("password", "hunter2")).toBe("[REDACTED]");
		});

		it("redacts secret fields", () => {
			expect(redactValue("secret", "my-secret")).toBe("[REDACTED]");
		});

		it("redacts token fields", () => {
			expect(redactValue("token", "tok-abc")).toBe("[REDACTED]");
		});

		it("redacts credential fields", () => {
			expect(redactValue("credential", "cred-abc")).toBe("[REDACTED]");
		});

		it("redacts x-telegram-bot-api-secret-token", () => {
			expect(redactValue("x-telegram-bot-api-secret-token", "secret-val")).toBe("[REDACTED]");
		});

		it("redacts setup_token_secret", () => {
			expect(redactValue("setup_token_secret", "secret-val")).toBe("[REDACTED]");
		});

		it("redacts jwt_secret", () => {
			expect(redactValue("jwt_secret", "secret-val")).toBe("[REDACTED]");
		});

		it("redacts encryption_master_key", () => {
			expect(redactValue("encryption_master_key", "key-val")).toBe("[REDACTED]");
		});

		it("redacts monica_api_token", () => {
			expect(redactValue("monica_api_token", "tok-val")).toBe("[REDACTED]");
		});

		it("redacts openai_api_key", () => {
			expect(redactValue("openai_api_key", "sk-val")).toBe("[REDACTED]");
		});

		it("redacts cookie fields", () => {
			expect(redactValue("cookie", "session=abc123")).toBe("[REDACTED]");
		});

		it("redacts fields containing sensitive substrings", () => {
			expect(redactValue("my_password_hash", "abc")).toBe("[REDACTED]");
			expect(redactValue("x-api-key", "abc")).toBe("[REDACTED]");
			expect(redactValue("auth_token_value", "abc")).toBe("[REDACTED]");
		});
	});

	describe("value-pattern based redaction", () => {
		it("redacts Bearer tokens in values", () => {
			expect(redactValue("x-custom", "Bearer abc123.def.ghi")).toBe("[REDACTED]");
		});

		it("redacts JWT-like values", () => {
			const jwt =
				"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
			expect(redactValue("some-field", jwt)).toBe("[REDACTED]");
		});

		it("redacts OpenAI API key pattern", () => {
			expect(redactValue("some-field", "sk-abcdefghijklmnopqrstuvwxyz")).toBe("[REDACTED]");
		});
	});

	describe("non-sensitive passthrough", () => {
		it("passes through non-sensitive string values", () => {
			expect(redactValue("user_name", "Alice")).toBe("Alice");
		});

		it("passes through numeric values", () => {
			expect(redactValue("count", 42)).toBe(42);
		});

		it("passes through boolean values", () => {
			expect(redactValue("active", true)).toBe(true);
		});

		it("passes through null", () => {
			expect(redactValue("field", null)).toBe(null);
		});

		it("passes through undefined", () => {
			expect(redactValue("field", undefined)).toBe(undefined);
		});

		it("passes through safe strings", () => {
			expect(redactValue("message", "Hello world")).toBe("Hello world");
		});

		it("does not redact the word 'Bearer' alone without a following token", () => {
			expect(redactValue("description", "Bearer")).toBe("Bearer");
		});
	});
});

describe("redactString", () => {
	it("redacts Bearer tokens embedded in strings", () => {
		const input = "Authorization: Bearer abc123_def.ghi-jkl";
		const result = redactString(input);
		expect(result).not.toContain("abc123_def.ghi-jkl");
		expect(result).toContain("[REDACTED]");
	});

	it("redacts JWT-like patterns in strings", () => {
		const jwt =
			"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
		const input = `Token was: ${jwt}`;
		const result = redactString(input);
		expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9");
		expect(result).toContain("[REDACTED]");
	});

	it("redacts OpenAI-style keys in strings", () => {
		const input = "Key: sk-abcdefghijklmnopqrstuvwxyz";
		const result = redactString(input);
		expect(result).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
		expect(result).toContain("[REDACTED]");
	});

	it("does not modify safe strings", () => {
		const input = "This is a normal log message";
		expect(redactString(input)).toBe("This is a normal log message");
	});

	it("handles empty strings", () => {
		expect(redactString("")).toBe("");
	});
});

describe("redactObject", () => {
	it("redacts sensitive fields in a flat object", () => {
		const input = {
			headers: { authorization: "Bearer tok" },
			body: "safe",
		};
		const result = redactObject(input);
		expect(result.headers.authorization).toBe("[REDACTED]");
		expect(result.body).toBe("safe");
	});

	it("does not mutate the original object", () => {
		const input = { authorization: "Bearer tok", safe: "value" };
		const result = redactObject(input);
		expect(input.authorization).toBe("Bearer tok");
		expect(result.authorization).toBe("[REDACTED]");
	});

	it("redacts nested objects recursively", () => {
		const input = {
			level1: {
				level2: {
					password: "secret123",
					name: "Alice",
				},
			},
		};
		const result = redactObject(input);
		expect(result.level1.level2.password).toBe("[REDACTED]");
		expect(result.level1.level2.name).toBe("Alice");
	});

	it("redacts sensitive values inside arrays", () => {
		const input = {
			items: [
				{ token: "abc123", label: "item1" },
				{ token: "def456", label: "item2" },
			],
		};
		const result = redactObject(input);
		expect(result.items[0].token).toBe("[REDACTED]");
		expect(result.items[0].label).toBe("item1");
		expect(result.items[1].token).toBe("[REDACTED]");
		expect(result.items[1].label).toBe("item2");
	});

	it("handles null values in objects", () => {
		const input = { field: null, password: "secret" };
		const result = redactObject(input);
		expect(result.field).toBe(null);
		expect(result.password).toBe("[REDACTED]");
	});

	it("handles arrays at root level", () => {
		const input = [{ authorization: "Bearer tok", safe: "val" }, { name: "Bob" }];
		const result = redactObject(input);
		expect(result[0].authorization).toBe("[REDACTED]");
		expect(result[0].safe).toBe("val");
		expect(result[1].name).toBe("Bob");
	});

	it("handles primitive input values", () => {
		expect(redactObject("hello" as unknown as object)).toBe("hello");
		expect(redactObject(42 as unknown as object)).toBe(42);
		expect(redactObject(null as unknown as object)).toBe(null);
	});

	it("redacts values that match sensitive patterns even in non-sensitive fields", () => {
		const input = {
			data: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
		};
		const result = redactObject(input);
		expect(result.data).toBe("[REDACTED]");
	});
});
