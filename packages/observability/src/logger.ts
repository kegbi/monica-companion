import { type AnyValueMap, type Logger, logs, SeverityNumber } from "@opentelemetry/api-logs";

export interface StructuredLogger {
	info(message: string, attributes?: AnyValueMap): void;
	warn(message: string, attributes?: AnyValueMap): void;
	error(message: string, attributes?: AnyValueMap): void;
	debug(message: string, attributes?: AnyValueMap): void;
}

/**
 * Create a structured logger backed by the OpenTelemetry Logs API.
 * Emits log records with severity, body, and optional structured attributes.
 */
export function createLogger(name: string): StructuredLogger {
	const logger: Logger = logs.getLoggerProvider().getLogger(name);

	function emit(
		severityNumber: SeverityNumber,
		severityText: string,
		message: string,
		attributes?: AnyValueMap,
	): void {
		logger.emit({
			severityNumber,
			severityText,
			body: message,
			attributes: attributes ?? {},
		});
	}

	return {
		info(message: string, attributes?: AnyValueMap): void {
			emit(SeverityNumber.INFO, "INFO", message, attributes);
		},
		warn(message: string, attributes?: AnyValueMap): void {
			emit(SeverityNumber.WARN, "WARN", message, attributes);
		},
		error(message: string, attributes?: AnyValueMap): void {
			emit(SeverityNumber.ERROR, "ERROR", message, attributes);
		},
		debug(message: string, attributes?: AnyValueMap): void {
			emit(SeverityNumber.DEBUG, "DEBUG", message, attributes);
		},
	};
}
