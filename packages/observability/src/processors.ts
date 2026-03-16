import { redactString, redactValue } from "@monica-companion/redaction";
import type { Context } from "@opentelemetry/api";
import type { LogRecordProcessor, SdkLogRecord } from "@opentelemetry/sdk-logs";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

/**
 * A LogRecordProcessor that sanitizes sensitive data from log record
 * attributes and body before delegating to an inner processor.
 */
export class RedactingLogProcessor implements LogRecordProcessor {
	constructor(private readonly inner: LogRecordProcessor) {}

	onEmit(logRecord: SdkLogRecord, context?: Context): void {
		// Redact sensitive attributes
		const attrs = logRecord.attributes;
		if (attrs && typeof attrs === "object") {
			for (const [key, value] of Object.entries(attrs)) {
				const redacted = redactValue(key, value);
				if (redacted !== value) {
					logRecord.setAttribute(key, redacted as string);
				}
			}
		}

		// Redact sensitive patterns in body
		const body = logRecord.body;
		if (typeof body === "string") {
			const redactedBody = redactString(body);
			if (redactedBody !== body) {
				logRecord.setBody(redactedBody);
			}
		}

		this.inner.onEmit(logRecord, context);
	}

	async shutdown(): Promise<void> {
		return this.inner.shutdown();
	}

	async forceFlush(): Promise<void> {
		return this.inner.forceFlush();
	}
}

/**
 * A SpanProcessor that sanitizes sensitive data from span attributes
 * before delegating to an inner processor.
 */
export class RedactingSpanProcessor implements SpanProcessor {
	constructor(private readonly inner: SpanProcessor) {}

	onStart(span: Span, parentContext: Context): void {
		this.inner.onStart(span, parentContext);
	}

	onEnd(span: ReadableSpan): void {
		const attrs = span.attributes;
		if (attrs && typeof attrs === "object") {
			for (const [key, value] of Object.entries(attrs)) {
				const redacted = redactValue(key, value);
				if (redacted !== value) {
					// At runtime, ReadableSpan objects are actually Span instances
					// with setAttribute available.
					(span as unknown as Span).setAttribute(key, redacted as string);
				}
			}
		}

		this.inner.onEnd(span);
	}

	async shutdown(): Promise<void> {
		return this.inner.shutdown();
	}

	async forceFlush(): Promise<void> {
		return this.inner.forceFlush();
	}
}
