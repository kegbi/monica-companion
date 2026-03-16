/**
 * Structured logger interface compatible with @monica-companion/observability StructuredLogger.
 * Defined here to avoid a direct dependency on the observability package from the API lib.
 */
export interface StructuredLogger {
	info(message: string, attributes?: Record<string, unknown>): void;
	warn(message: string, attributes?: Record<string, unknown>): void;
	error(message: string, attributes?: Record<string, unknown>): void;
	debug(message: string, attributes?: Record<string, unknown>): void;
}
