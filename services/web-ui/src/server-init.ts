import { createLogger, initTelemetry } from "@monica-companion/observability";

const serviceName = import.meta.env.SERVICE_NAME ?? "web-ui";

export const telemetry = initTelemetry({
	serviceName,
	otlpEndpoint: import.meta.env.OTEL_EXPORTER_OTLP_ENDPOINT,
	enabled: !!import.meta.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

export const logger = createLogger("web-ui");
