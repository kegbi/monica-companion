/**
 * Barrel export for all benchmark fixtures.
 *
 * ALL DATA IN FIXTURE FILES IS SYNTHETIC.
 */
import type { BenchmarkCase } from "@monica-companion/types";
import { clarificationCases } from "./clarification-turns.js";
import { contactResolutionCases } from "./contact-resolution.js";
import { readIntentCases } from "./read-intents.js";
import { writeIntentCases } from "./write-intents.js";

export { clarificationCases } from "./clarification-turns.js";
export { contactResolutionCases } from "./contact-resolution.js";
export { readIntentCases } from "./read-intents.js";
export { writeIntentCases } from "./write-intents.js";

/** All benchmark cases combined. */
export const allBenchmarkCases: BenchmarkCase[] = [
	...contactResolutionCases,
	...writeIntentCases,
	...readIntentCases,
	...clarificationCases,
];
