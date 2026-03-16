/**
 * Patterns for identifying sensitive field names and values.
 * Used by the redaction functions to sanitize data before it reaches
 * observability backends (logs, traces, metrics).
 */

/**
 * Field name patterns that indicate the value should always be redacted.
 * Matched case-insensitively against the full field name.
 */
export const SENSITIVE_FIELD_PATTERNS: ReadonlyArray<RegExp> = [
	/authorization/i,
	/api[_-]?key/i,
	/password/i,
	/secret/i,
	/token/i,
	/credential/i,
	/cookie/i,
	/encryption[_-]?master[_-]?key/i,
];

/**
 * Value patterns that indicate the string contains sensitive data,
 * regardless of the field name.
 */
export const SENSITIVE_VALUE_PATTERNS: ReadonlyArray<RegExp> = [
	// Bearer tokens: "Bearer " followed by token characters
	/Bearer [A-Za-z0-9._-]+/,
	// JWT-like: three base64url segments separated by dots
	/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
	// OpenAI API key pattern
	/sk-[A-Za-z0-9]{20,}/,
];
