import { SENSITIVE_FIELD_PATTERNS, SENSITIVE_VALUE_PATTERNS } from "./patterns";

const REDACTED = "[REDACTED]";

/**
 * Check whether a field name matches any sensitive field pattern.
 */
function isSensitiveFieldName(key: string): boolean {
	return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Check whether a string value matches any sensitive value pattern.
 */
function isSensitiveValue(value: string): boolean {
	return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Redact a single key-value pair. Returns `[REDACTED]` if either the
 * field name or the value matches sensitive patterns. Otherwise returns
 * the original value unchanged.
 */
export function redactValue(key: string, value: unknown): unknown {
	if (isSensitiveFieldName(key)) {
		return REDACTED;
	}

	if (typeof value === "string" && isSensitiveValue(value)) {
		return REDACTED;
	}

	return value;
}

/**
 * Replace sensitive patterns found within a string. This operates on
 * the string content itself, replacing known secret patterns with
 * `[REDACTED]`. Useful for log message bodies.
 */
export function redactString(value: string): string {
	let result = value;
	for (const pattern of SENSITIVE_VALUE_PATTERNS) {
		result = result.replace(new RegExp(pattern.source, "g"), REDACTED);
	}
	return result;
}

/**
 * Deep-clone an object and redact all sensitive fields and values.
 * Does not mutate the original object.
 */
export function redactObject<T>(obj: T): T {
	return redactNode("", obj) as T;
}

function redactNode(key: string, value: unknown): unknown {
	if (value === null || value === undefined) {
		return value;
	}

	if (typeof value === "string") {
		if (key && isSensitiveFieldName(key)) {
			return REDACTED;
		}
		if (isSensitiveValue(value)) {
			return REDACTED;
		}
		return value;
	}

	if (typeof value !== "object") {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map((item) => redactNode("", item));
	}

	const result: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		if (isSensitiveFieldName(k)) {
			result[k] = REDACTED;
		} else {
			result[k] = redactNode(k, v);
		}
	}
	return result;
}
