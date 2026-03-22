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
import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";

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

const OTEL_RESOLVE_DIR = resolve(PACKAGES, "observability");

const OTEL_PACKAGES = [
	"@opentelemetry/api",
	"@opentelemetry/api-logs",
	"@opentelemetry/exporter-logs-otlp-http",
	"@opentelemetry/exporter-metrics-otlp-http",
	"@opentelemetry/exporter-trace-otlp-http",
	"@opentelemetry/resources",
	"@opentelemetry/sdk-logs",
	"@opentelemetry/sdk-metrics",
	"@opentelemetry/sdk-node",
	"@opentelemetry/sdk-trace-base",
	"@opentelemetry/semantic-conventions",
] as const;

/**
 * Resolve a scoped package to its root directory using require.resolve.
 * Follows the resolved entry point path back to the package root
 * (the directory containing `@scope/name`).
 */
function resolvePackageRoot(name: string, from: string): string {
	const require_ = createRequire(resolve(from, "package.json"));
	const resolved = require_.resolve(name);
	// Find the last occurrence of /node_modules/@scope/pkg in the resolved path
	const needle = `${sep}${join("node_modules", ...name.split("/"))}`;
	const idx = resolved.lastIndexOf(needle);
	if (idx === -1) {
		throw new Error(`Could not find package root for "${name}" in resolved path: ${resolved}`);
	}
	return resolved.substring(0, idx + needle.length);
}

/**
 * Returns all OpenTelemetry package aliases required by the observability
 * workspace package. Spread this into the `alias` object of any vitest
 * config that aliases `@monica-companion/observability`.
 *
 * Uses `pkg()` for packages findable in the pnpm store, and falls back
 * to `require.resolve` from the observability package for long-named
 * packages whose pnpm store directories are truncated to hashes.
 */
export function otelAliases(): Record<string, string> {
	const aliases: Record<string, string> = {};
	for (const name of OTEL_PACKAGES) {
		try {
			aliases[name] = pkg(name);
		} catch {
			aliases[name] = resolvePackageRoot(name, OTEL_RESOLVE_DIR);
		}
	}
	return aliases;
}
