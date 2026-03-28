import { describe, expect, it } from "vitest";
import { sanitizeTelegramMarkdown } from "../sanitize-markdown";

describe("sanitizeTelegramMarkdown", () => {
	describe("plain text passthrough", () => {
		it("returns text without markers unchanged", () => {
			expect(sanitizeTelegramMarkdown("Hello world")).toBe("Hello world");
		});

		it("returns empty string unchanged", () => {
			expect(sanitizeTelegramMarkdown("")).toBe("");
		});
	});

	describe("bold markers (*)", () => {
		it("preserves properly paired bold markers", () => {
			expect(sanitizeTelegramMarkdown("Hello *world*!")).toBe("Hello *world*!");
		});

		it("preserves multiple paired bold markers", () => {
			expect(sanitizeTelegramMarkdown("*one* and *two*")).toBe("*one* and *two*");
		});

		it("removes unpaired bold marker", () => {
			expect(sanitizeTelegramMarkdown("Hello *world")).toBe("Hello world");
		});

		it("removes last unpaired bold marker when mixed with pairs", () => {
			expect(sanitizeTelegramMarkdown("*bold* and *oops")).toBe("*bold* and oops");
		});
	});

	describe("italic markers (_)", () => {
		it("preserves properly paired italic markers", () => {
			expect(sanitizeTelegramMarkdown("Hello _world_!")).toBe("Hello _world_!");
		});

		it("removes unpaired italic marker", () => {
			expect(sanitizeTelegramMarkdown("Hello _world")).toBe("Hello world");
		});

		it("removes last unpaired italic with mixed pairs", () => {
			expect(sanitizeTelegramMarkdown("_italic_ and _oops")).toBe("_italic_ and oops");
		});
	});

	describe("inline code (`)", () => {
		it("preserves properly paired inline code", () => {
			expect(sanitizeTelegramMarkdown("Run `npm install` now")).toBe("Run `npm install` now");
		});

		it("removes unpaired backtick", () => {
			expect(sanitizeTelegramMarkdown("Run `npm install")).toBe("Run npm install");
		});
	});

	describe("code blocks (```)", () => {
		it("preserves properly paired code blocks", () => {
			const text = "```js\nconst x = 1;\n```";
			expect(sanitizeTelegramMarkdown(text)).toBe(text);
		});

		it("closes unclosed code block", () => {
			expect(sanitizeTelegramMarkdown("```js\nconst x = 1;")).toBe("```js\nconst x = 1;\n```");
		});
	});

	describe("code spans protect contents", () => {
		it("does not modify markers inside code blocks", () => {
			const text = "```\n*not bold* _not italic_\n```";
			expect(sanitizeTelegramMarkdown(text)).toBe(text);
		});

		it("does not modify markers inside inline code", () => {
			const text = "Run `*bold*` command";
			expect(sanitizeTelegramMarkdown(text)).toBe(text);
		});
	});

	describe("mixed formatting", () => {
		it("handles all paired markers together", () => {
			const text = "*bold* and _italic_ and `code`";
			expect(sanitizeTelegramMarkdown(text)).toBe(text);
		});

		it("fixes multiple unpaired markers", () => {
			expect(sanitizeTelegramMarkdown("*bold _italic")).toBe("bold italic");
		});

		it("preserves paired markers while removing unpaired ones", () => {
			expect(sanitizeTelegramMarkdown("*bold* _italic `code")).toBe("*bold* italic code");
		});
	});
});
