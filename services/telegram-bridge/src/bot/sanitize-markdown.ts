/**
 * Sanitize text for Telegram's legacy Markdown parser.
 *
 * Ensures formatting markers (*, _, `) are properly paired so Telegram
 * does not reject the message with a "can't parse entities" error.
 * Unpaired markers are removed; code spans are left untouched.
 */
export function sanitizeTelegramMarkdown(text: string): string {
	if (!text) return text;

	// Step 1: Close unclosed triple-backtick code blocks
	const tripleCount = (text.match(/```/g) || []).length;
	if (tripleCount % 2 !== 0) {
		text += "\n```";
	}

	// Step 2: Protect code blocks from further processing
	const spans: { placeholder: string; original: string }[] = [];
	let idx = 0;

	let result = text.replace(/```[\s\S]*?```/g, (match) => {
		const ph = `\x00${idx++}\x00`;
		spans.push({ placeholder: ph, original: match });
		return ph;
	});

	// Step 3: Protect inline code spans
	result = result.replace(/`[^`\n]+`/g, (match) => {
		const ph = `\x00${idx++}\x00`;
		spans.push({ placeholder: ph, original: match });
		return ph;
	});

	// Step 4: Remove unpaired backticks
	if ((result.match(/`/g) || []).length % 2 !== 0) {
		result = result.replace(/`/g, "");
	}

	// Step 5: Remove unpaired bold markers (*)
	if ((result.match(/\*/g) || []).length % 2 !== 0) {
		const lastIdx = result.lastIndexOf("*");
		result = result.slice(0, lastIdx) + result.slice(lastIdx + 1);
	}

	// Step 6: Remove unpaired italic markers (_)
	if ((result.match(/_/g) || []).length % 2 !== 0) {
		const lastIdx = result.lastIndexOf("_");
		result = result.slice(0, lastIdx) + result.slice(lastIdx + 1);
	}

	// Step 7: Restore protected code spans
	for (const s of spans) {
		result = result.replace(s.placeholder, s.original);
	}

	return result;
}
