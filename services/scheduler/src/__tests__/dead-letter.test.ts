import { describe, expect, it, vi } from "vitest";
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
				error: "Internal error",
				attemptCount: 3,
				payload: { type: "create_activity", summary: "Lunch" },
			},
			deps,
		);

		expect(deps.deliveryClient.fetch).toHaveBeenCalled();
	});
});
