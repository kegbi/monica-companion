import { describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/api", () => ({
	trace: {
		getTracer: () => ({
			startActiveSpan: (_name: string, fn: (span: unknown) => unknown) =>
				fn({
					setAttribute: () => {},
					end: () => {},
				}),
		}),
	},
}));

vi.mock("@monica-companion/redaction", () => ({
	redactObject: (obj: unknown) => {
		if (typeof obj !== "object" || obj === null) return obj;
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
			const sensitiveKeys = ["apiToken", "password", "secret", "token", "key"];
			if (sensitiveKeys.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
				result[key] = "[REDACTED]";
			} else {
				result[key] = value;
			}
		}
		return result;
	},
}));

vi.mock("drizzle-orm", () => ({
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

import { type DeadLetterDeps, handleDeadLetter } from "../lib/dead-letter";

function createMockDeps(): DeadLetterDeps {
	return {
		deliveryClient: {
			fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
		},
		db: {
			execute: vi.fn().mockResolvedValue([]),
		},
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		},
	};
}

describe("handleDeadLetter", () => {
	it("redacts sensitive data from payload", async () => {
		const deps = createMockDeps();
		await handleDeadLetter(
			{
				jobId: "job-1",
				queue: "command-execution",
				executionId: "exec-1",
				userId: "user-1",
				correlationId: "corr-1",
				connectorType: "telegram",
				connectorRoutingId: "chat-100",
				error: "Request failed",
				attemptCount: 3,
				payload: {
					type: "create_contact",
					firstName: "Jane",
					apiToken: "secret-token-123",
					password: "secret-password",
				},
			},
			deps,
		);

		// Verify the logged payload has sensitive fields redacted
		const logCall = (deps.logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(logCall[0]).toContain("Dead letter");
		const logAttrs = logCall[1];
		expect(logAttrs.payload).not.toContain("secret-token-123");
		expect(logAttrs.payload).not.toContain("secret-password");
	});

	it("updates execution status to dead_lettered", async () => {
		const deps = createMockDeps();
		await handleDeadLetter(
			{
				jobId: "job-2",
				queue: "command-execution",
				executionId: "exec-2",
				userId: "user-1",
				correlationId: "corr-2",
				connectorType: "telegram",
				connectorRoutingId: "chat-200",
				error: "Timeout",
				attemptCount: 3,
				payload: { type: "create_note", contactId: 1, body: "test" },
			},
			deps,
		);

		expect(deps.db.execute).toHaveBeenCalled();
	});

	it("sends error notification to delivery", async () => {
		const deps = createMockDeps();
		await handleDeadLetter(
			{
				jobId: "job-3",
				queue: "command-execution",
				executionId: "exec-3",
				userId: "user-1",
				correlationId: "corr-3",
				connectorType: "telegram",
				connectorRoutingId: "chat-123",
				error: "Internal error",
				attemptCount: 3,
				payload: { type: "create_activity", summary: "Lunch" },
			},
			deps,
		);

		expect(deps.deliveryClient.fetch).toHaveBeenCalled();
	});

	it("uses connectorType and connectorRoutingId from payload in delivery intent", async () => {
		const deps = createMockDeps();
		await handleDeadLetter(
			{
				jobId: "job-4",
				queue: "command-execution",
				executionId: "exec-4",
				userId: "user-1",
				correlationId: "corr-4",
				connectorType: "whatsapp",
				connectorRoutingId: "wa-chat-789",
				error: "Timeout",
				attemptCount: 3,
				payload: { type: "create_note", contactId: 1, body: "test" },
			},
			deps,
		);

		const deliveryCall = (deps.deliveryClient.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(deliveryCall[1].body);
		expect(body.connectorType).toBe("whatsapp");
		expect(body.connectorRoutingId).toBe("wa-chat-789");
	});

	it("regression: connectorRoutingId is never empty string in delivery intent", async () => {
		const deps = createMockDeps();
		await handleDeadLetter(
			{
				jobId: "job-5",
				queue: "command-execution",
				executionId: "exec-5",
				userId: "user-1",
				correlationId: "corr-5",
				connectorType: "telegram",
				connectorRoutingId: "chat-456",
				error: "Failed",
				attemptCount: 3,
				payload: { type: "create_contact", firstName: "Jane" },
			},
			deps,
		);

		const deliveryCall = (deps.deliveryClient.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(deliveryCall[1].body);
		expect(body.connectorRoutingId).not.toBe("");
		expect(body.connectorRoutingId.length).toBeGreaterThan(0);
	});
});
