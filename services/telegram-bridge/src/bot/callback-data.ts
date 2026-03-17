const CALLBACK_DATA_MAX_BYTES = 64;
const SEPARATOR = ":";

export interface CallbackDataPayload {
	action: string;
	pendingCommandId: string;
	version: number;
}

/**
 * Encodes callback data into a compact string format.
 * Format: action:pendingCommandId:version
 * Enforces Telegram's 64-byte limit at encode time.
 */
export function encodeCallbackData(
	action: string,
	pendingCommandId: string,
	version: number,
): string {
	const encoded = `${action}${SEPARATOR}${pendingCommandId}${SEPARATOR}${version}`;
	const byteLength = new TextEncoder().encode(encoded).length;
	if (byteLength > CALLBACK_DATA_MAX_BYTES) {
		throw new Error(`Callback data exceeds 64-byte limit (${byteLength} bytes): ${encoded}`);
	}
	return encoded;
}

/**
 * Decodes callback data string back into its components.
 * Returns null if the format is invalid.
 */
export function decodeCallbackData(data: string): CallbackDataPayload | null {
	const parts = data.split(SEPARATOR);
	if (parts.length < 3) return null;

	const action = parts[0];
	const version = Number(parts[parts.length - 1]);
	if (!action || Number.isNaN(version)) return null;

	// pendingCommandId may contain colons, so join everything between action and version
	const pendingCommandId = parts.slice(1, -1).join(SEPARATOR);
	if (!pendingCommandId) return null;

	return { action, pendingCommandId, version };
}
