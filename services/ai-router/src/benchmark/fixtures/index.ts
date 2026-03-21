/**
 * Barrel export for benchmark fixtures.
 *
 * ALL DATA IN FIXTURE FILES IS SYNTHETIC.
 *
 * Intent classification fixtures have been migrated to YAML datasets
 * in promptfoo/datasets/ and are no longer maintained as TypeScript.
 * Only contact-resolution fixtures remain here.
 */
import type { BenchmarkCase } from "@monica-companion/types";
import { contactResolutionCases } from "./contact-resolution.js";

export { contactResolutionCases } from "./contact-resolution.js";

/** All benchmark cases combined (contact-resolution only). */
export const allBenchmarkCases: BenchmarkCase[] = [...contactResolutionCases];
