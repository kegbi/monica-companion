import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { type TelemetryConfig, telemetryConfigSchema } from "./config";
import { RedactingLogProcessor, RedactingSpanProcessor } from "./processors";

/**
 * Initialize the OpenTelemetry SDK with trace, metric, and log providers.
 * Redacting processors are wired in to sanitize sensitive data before export.
 *
 * Must be called before importing application code to ensure auto-instrumentation
 * hooks are registered. Services should use a preload module pattern:
 *
 * ```ts
 * // src/instrumentation.ts (loaded before app)
 * import { initTelemetry } from "@monica-companion/observability";
 * initTelemetry({ serviceName: "my-service" });
 * ```
 *
 * Returns a shutdown function that flushes and closes all providers.
 * When `enabled` is false (e.g., in tests), returns a no-op shutdown.
 */
export function initTelemetry(rawConfig: Partial<TelemetryConfig> & { serviceName: string }): {
	shutdown: () => Promise<void>;
} {
	const config = telemetryConfigSchema.parse(rawConfig);

	if (!config.enabled) {
		return {
			shutdown: () => Promise.resolve(),
		};
	}

	const endpoint = config.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

	const resource = resourceFromAttributes({
		[ATTR_SERVICE_NAME]: config.serviceName,
	});

	// Trace exporter + redacting processor
	const traceExporter = new OTLPTraceExporter({
		url: endpoint ? `${endpoint}/v1/traces` : undefined,
	});
	const spanProcessor = new RedactingSpanProcessor(new BatchSpanProcessor(traceExporter));

	// Log exporter + redacting processor
	const logExporter = new OTLPLogExporter({
		url: endpoint ? `${endpoint}/v1/logs` : undefined,
	});
	const logProcessor = new RedactingLogProcessor(new BatchLogRecordProcessor(logExporter));

	// Metric exporter
	const metricExporter = new OTLPMetricExporter({
		url: endpoint ? `${endpoint}/v1/metrics` : undefined,
	});
	const metricReader = new PeriodicExportingMetricReader({
		exporter: metricExporter,
		exportIntervalMillis: 15000,
	});

	const sdk = new NodeSDK({
		resource,
		spanProcessors: [spanProcessor],
		logRecordProcessors: [logProcessor],
		metricReader,
	});

	sdk.start();

	return {
		shutdown: async () => {
			await sdk.shutdown();
		},
	};
}
