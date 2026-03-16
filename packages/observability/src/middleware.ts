import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";

/**
 * Hono middleware that creates spans for HTTP requests, records
 * route info, status code, and latency in span attributes.
 * Works alongside OTel auto-instrumentation by enriching the
 * active span with Hono-specific route information.
 */
export function otelMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		const tracer = trace.getTracer("hono-middleware");
		const startTime = Date.now();

		const span = tracer.startSpan(`${c.req.method} ${c.req.path}`);

		span.setAttribute("http.method", c.req.method);
		span.setAttribute("http.target", c.req.path);
		span.setAttribute("http.url", c.req.url);

		try {
			await next();

			span.setAttribute("http.status_code", c.res.status);

			if (c.res.status >= 500) {
				span.setStatus({ code: SpanStatusCode.ERROR });
			} else {
				span.setStatus({ code: SpanStatusCode.OK });
			}
		} catch (error) {
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: error instanceof Error ? error.message : "Unknown error",
			});
			throw error;
		} finally {
			const duration = Date.now() - startTime;
			span.setAttribute("http.duration_ms", duration);
			span.end();
		}
	};
}
