import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Boundary enforcement test: verifies that scheduler source files
 * do not contain hardcoded Telegram-specific string literals.
 *
 * Per service-boundary rules: scheduler operates on confirmed command
 * payloads, not Telegram messages or raw Monica schemas.
 */
describe("scheduler connector-neutrality boundary", () => {
	const srcDir = resolve(__dirname, "..");

	function collectSourceFiles(dir: string): string[] {
		const files: string[] = [];
		for (const entry of readdirSync(dir)) {
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				if (entry === "__tests__" || entry === "node_modules" || entry === "dist") continue;
				files.push(...collectSourceFiles(fullPath));
			} else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
				files.push(fullPath);
			}
		}
		return files;
	}

	it("does not contain hardcoded 'telegram' string literals in non-test source files", () => {
		const files = collectSourceFiles(srcDir);
		const violations: string[] = [];

		for (const file of files) {
			const content = readFileSync(file, "utf-8");
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				// Match string literals containing "telegram" (case-insensitive)
				// but skip comments, config default values, and type imports
				if (
					/["']telegram["']/i.test(line) &&
					!line.trim().startsWith("//") &&
					!line.trim().startsWith("*")
				) {
					violations.push(`${file}:${i + 1}: ${line.trim()}`);
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it("does not import from grammy or telegram-specific packages", () => {
		const files = collectSourceFiles(srcDir);
		const violations: string[] = [];

		for (const file of files) {
			const content = readFileSync(file, "utf-8");
			if (/from\s+['"]grammy/.test(content) || /from\s+['"].*telegram/.test(content)) {
				violations.push(file);
			}
		}

		expect(violations).toEqual([]);
	});
});
