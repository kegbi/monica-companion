/**
 * Dynamic pnpm package resolver for Vitest alias configs.
 *
 * Finds packages in the .pnpm store by name prefix instead of
 * hardcoding version strings. This avoids breaking all vitest
 * configs on every dependency version bump.
 *
 * Why this exists: pnpm on Windows creates directory junctions that
 * Node.js require.resolve() cannot follow reliably. The old workaround
 * was hardcoded paths like:
 *   resolve(pnpmStore, "zod@4.3.6/node_modules/zod/v4")
 * which broke on every version change across 6+ vitest configs.
 */

import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const PNPM_STORE = resolve(ROOT, "node_modules/.pnpm");
const PACKAGES = resolve(ROOT, "packages");

let _storeEntries: string[] | null = null;
function storeEntries(): string[] {
	if (!_storeEntries) _storeEntries = readdirSync(PNPM_STORE);
	return _storeEntries;
}

/**
 * Find a package in the pnpm store by name.
 *
 * Converts the npm package name to the pnpm directory prefix
 * (e.g. "@langchain/openai" → "@langchain+openai@") and finds
 * the first matching directory. Returns the resolved path to
 * node_modules/<name>/<subpath> inside that store entry.
 *
 * @param name - npm package name (e.g. "zod", "@langchain/openai")
 * @param subpath - optional path within the package (e.g. "v4", "dist/index.js")
 */
export function pkg(name: string, subpath = ""): string {
	const prefix = `${name.replace("/", "+")}@`;
	const match = storeEntries().find((d) => d.startsWith(prefix));
	if (!match) {
		throw new Error(
			`Package "${name}" not found in pnpm store. Looked for prefix "${prefix}" in ${PNPM_STORE}`,
		);
	}
	return resolve(PNPM_STORE, match, "node_modules", name, subpath);
}

/**
 * Resolve a @monica-companion workspace package to its TypeScript source.
 *
 * @param name - full package name (e.g. "@monica-companion/auth")
 */
export function workspace(name: string): string {
	const short = name.replace("@monica-companion/", "");
	return resolve(PACKAGES, short, "src/index.ts");
}
