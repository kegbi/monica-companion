import { initTelemetry } from "@monica-companion/observability";

const serviceName = process.env.SERVICE_NAME ?? "delivery";

export const telemetry = initTelemetry({
	serviceName,
	otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
	enabled: !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});
