import { describe, expect, it, vi } from "vitest";
import { RedactingLogProcessor, RedactingSpanProcessor } from "../processors";

describe("RedactingLogProcessor", () => {
	it("redacts log record attributes containing sensitive field names", () => {
		const innerProcessor = {
			onEmit: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			forceFlush: vi.fn().mockResolvedValue(undefined),
		};

		const processor = new RedactingLogProcessor(innerProcessor);

		const attributes: Record<string, unknown> = {
			authorization: "Bearer secret-token",
			message: "safe-message",
		};

		const mockLogRecord = {
			attributes,
			setAttributes: vi.fn((newAttrs: Record<string, unknown>) => {
				Object.assign(attributes, newAttrs);
			}),
			setAttribute: vi.fn((key: string, value: unknown) => {
				attributes[key] = value;
			}),
			body: "test body",
			setBody: vi.fn(),
		};

		processor.onEmit(mockLogRecord as never);

		expect(innerProcessor.onEmit).toHaveBeenCalledOnce();
		// The processor should have called setAttribute for the sensitive field
		expect(mockLogRecord.setAttribute).toHaveBeenCalledWith("authorization", "[REDACTED]");
	});

	it("redacts log body containing sensitive patterns", () => {
		const innerProcessor = {
			onEmit: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			forceFlush: vi.fn().mockResolvedValue(undefined),
		};

		const processor = new RedactingLogProcessor(innerProcessor);

		const mockLogRecord = {
			attributes: {},
			setAttributes: vi.fn(),
			setAttribute: vi.fn(),
			body: "Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
			setBody: vi.fn(),
		};

		processor.onEmit(mockLogRecord as never);

		expect(mockLogRecord.setBody).toHaveBeenCalled();
		const newBody = mockLogRecord.setBody.mock.calls[0][0];
		expect(newBody).not.toContain("eyJhbGciOiJIUzI1NiJ9");
		expect(newBody).toContain("[REDACTED]");
	});

	it("delegates shutdown to inner processor", async () => {
		const innerProcessor = {
			onEmit: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			forceFlush: vi.fn().mockResolvedValue(undefined),
		};

		const processor = new RedactingLogProcessor(innerProcessor);
		await processor.shutdown();
		expect(innerProcessor.shutdown).toHaveBeenCalledOnce();
	});

	it("delegates forceFlush to inner processor", async () => {
		const innerProcessor = {
			onEmit: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			forceFlush: vi.fn().mockResolvedValue(undefined),
		};

		const processor = new RedactingLogProcessor(innerProcessor);
		await processor.forceFlush();
		expect(innerProcessor.forceFlush).toHaveBeenCalledOnce();
	});

	it("passes through non-sensitive attributes unchanged", () => {
		const innerProcessor = {
			onEmit: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			forceFlush: vi.fn().mockResolvedValue(undefined),
		};

		const processor = new RedactingLogProcessor(innerProcessor);

		const mockLogRecord = {
			attributes: { route: "/health", method: "GET" },
			setAttributes: vi.fn(),
			setAttribute: vi.fn(),
			body: "Health check",
			setBody: vi.fn(),
		};

		processor.onEmit(mockLogRecord as never);

		// setAttribute should not have been called because no sensitive attributes
		expect(mockLogRecord.setAttribute).not.toHaveBeenCalled();
		// setBody should not have been called because body is safe
		expect(mockLogRecord.setBody).not.toHaveBeenCalled();
		expect(innerProcessor.onEmit).toHaveBeenCalledOnce();
	});
});

describe("RedactingSpanProcessor", () => {
	it("redacts span attributes containing sensitive values on end", () => {
		const innerProcessor = {
			onStart: vi.fn(),
			onEnd: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			forceFlush: vi.fn().mockResolvedValue(undefined),
		};

		const processor = new RedactingSpanProcessor(innerProcessor);

		const attributes: Record<string, unknown> = {
			"http.request.header.authorization": "Bearer secret-token-value",
			"http.route": "/api/test",
		};

		const mockSpan = {
			attributes,
			setAttribute: vi.fn((key: string, value: unknown) => {
				attributes[key] = value;
			}),
		};

		processor.onEnd(mockSpan as never);

		expect(innerProcessor.onEnd).toHaveBeenCalledOnce();
		expect(mockSpan.setAttribute).toHaveBeenCalledWith(
			"http.request.header.authorization",
			"[REDACTED]",
		);
	});

	it("passes onStart through to inner processor", () => {
		const innerProcessor = {
			onStart: vi.fn(),
			onEnd: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			forceFlush: vi.fn().mockResolvedValue(undefined),
		};

		const processor = new RedactingSpanProcessor(innerProcessor);
		const mockSpan = {} as never;
		const mockContext = {} as never;

		processor.onStart(mockSpan, mockContext);
		expect(innerProcessor.onStart).toHaveBeenCalledWith(mockSpan, mockContext);
	});

	it("delegates shutdown to inner processor", async () => {
		const innerProcessor = {
			onStart: vi.fn(),
			onEnd: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			forceFlush: vi.fn().mockResolvedValue(undefined),
		};

		const processor = new RedactingSpanProcessor(innerProcessor);
		await processor.shutdown();
		expect(innerProcessor.shutdown).toHaveBeenCalledOnce();
	});

	it("does not redact non-sensitive span attributes", () => {
		const innerProcessor = {
			onStart: vi.fn(),
			onEnd: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			forceFlush: vi.fn().mockResolvedValue(undefined),
		};

		const processor = new RedactingSpanProcessor(innerProcessor);

		const mockSpan = {
			attributes: { "http.route": "/health", "http.method": "GET" },
			setAttribute: vi.fn(),
		};

		processor.onEnd(mockSpan as never);

		expect(mockSpan.setAttribute).not.toHaveBeenCalled();
		expect(innerProcessor.onEnd).toHaveBeenCalledOnce();
	});
});
