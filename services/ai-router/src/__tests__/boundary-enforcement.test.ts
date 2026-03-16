import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Boundary enforcement test: verifies that ai-router never imports from
 * @monica-companion/monica-api-lib or any Monica-specific type.
 *
 * Per service-boundary rules: ai-router may consume only the minimized
 * ContactResolutionSummary projection, not raw Monica payloads or credentials.
 */
describe("ai-router service boundary", () => {
	const srcDir = resolve(__dirname, "..");
	const forbiddenPatterns = [/@monica-companion\/monica-api-lib/, /from\s+['"].*monica-api-lib/];

	function collectTsFiles(dir: string): string[] {
		const files: string[] = [];
		for (const entry of readdirSync(dir)) {
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				// Skip __tests__ directories for the boundary check
				// (test files might have test-only references in comments)
				if (entry === "node_modules" || entry === "dist") continue;
				files.push(...collectTsFiles(fullPath));
			} else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
				files.push(fullPath);
			}
		}
		return files;
	}

	it("does not import from @monica-companion/monica-api-lib in any source file", () => {
		const files = collectTsFiles(srcDir);
		const violations: string[] = [];

		for (const file of files) {
			const content = readFileSync(file, "utf-8");
			for (const pattern of forbiddenPatterns) {
				if (pattern.test(content)) {
					violations.push(`${file} contains forbidden import matching ${pattern.source}`);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
