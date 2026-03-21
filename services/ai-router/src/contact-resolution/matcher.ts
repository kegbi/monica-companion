import type {
	ContactMatchCandidate,
	ContactResolutionSummary,
	MatchReason,
} from "@monica-companion/types";

/**
 * Static lookup table mapping common natural-language kinship terms
 * to Monica relationship type names. English-only in V1.
 *
 * Each entry maps a user-facing term to an array of Monica relationship
 * labels that could indicate the relationship. For symmetric types
 * (e.g., spouse, sibling), the array has one element. For asymmetric
 * types (e.g., parent/child), the array includes both directions
 * because Monica's label semantics are directional: `relationshipLabels:
 * ["parent"]` on contact A means "A has a parent listed", not "A is a
 * parent." Both the direct and inverse labels are valid match signals;
 * disambiguation narrows ambiguous results downstream.
 */
const KINSHIP_MAP = new Map<string, string[]>([
	// Asymmetric: parent/child
	["mom", ["parent", "child"]],
	["mother", ["parent", "child"]],
	["mama", ["parent", "child"]],
	["mum", ["parent", "child"]],
	["dad", ["parent", "child"]],
	["father", ["parent", "child"]],
	["papa", ["parent", "child"]],
	["son", ["child", "parent"]],
	["daughter", ["child", "parent"]],

	// Symmetric: sibling
	["brother", ["sibling"]],
	["bro", ["sibling"]],
	["sister", ["sibling"]],
	["sis", ["sibling"]],

	// Asymmetric: grandparent/grandchild
	["grandma", ["grandparent", "grandchild"]],
	["grandmother", ["grandparent", "grandchild"]],
	["nana", ["grandparent", "grandchild"]],
	["grandpa", ["grandparent", "grandchild"]],
	["grandfather", ["grandparent", "grandchild"]],

	// Asymmetric: uncle/nephew
	["uncle", ["uncle", "nephew"]],
	["aunt", ["uncle", "nephew"]],
	["auntie", ["uncle", "nephew"]],
	["nephew", ["nephew", "uncle"]],
	["niece", ["nephew", "uncle"]],

	// Symmetric: cousin
	["cousin", ["cousin"]],

	// Symmetric: spouse
	["wife", ["spouse"]],
	["husband", ["spouse"]],

	// Symmetric: partner
	["partner", ["partner"]],
	["boyfriend", ["partner"]],
	["girlfriend", ["partner"]],

	// Asymmetric: boss/subordinate
	["boss", ["boss", "subordinate"]],
	["subordinate", ["subordinate", "boss"]],

	// Symmetric: colleague
	["colleague", ["colleague"]],
	["coworker", ["colleague"]],

	// Symmetric: friend
	["friend", ["friend"]],
	["buddy", ["friend"]],
	["pal", ["friend"]],

	// Symmetric: bestfriend
	["best friend", ["bestfriend"]],
	["bestfriend", ["bestfriend"]],
	["bff", ["bestfriend"]],

	// Asymmetric: mentor/protege
	["mentor", ["mentor", "protege"]],
	["protege", ["protege", "mentor"]],

	// Asymmetric: godparent/godchild
	["godfather", ["godparent", "godchild"]],
	["godmother", ["godparent", "godchild"]],
	["godson", ["godchild", "godparent"]],
	["goddaughter", ["godchild", "godparent"]],

	// Asymmetric: stepparent/stepchild
	["stepmom", ["stepparent", "stepchild"]],
	["stepmother", ["stepparent", "stepchild"]],
	["stepdad", ["stepparent", "stepchild"]],
	["stepfather", ["stepparent", "stepchild"]],
	["stepson", ["stepchild", "stepparent"]],
	["stepdaughter", ["stepchild", "stepparent"]],
]);

/** Minimum prefix length required for prefix matching. */
const MIN_PREFIX_LENGTH = 2;

/**
 * Normalize a query string: lowercase, trim, strip possessives, strip leading "my ".
 */
function normalizeQuery(raw: string): string {
	let q = raw.toLowerCase().trim();
	// Strip possessives like "'s" at the end
	q = q.replace(/'s$/i, "");
	// Strip leading "my "
	q = q.replace(/^my\s+/, "");
	return q.trim();
}

/**
 * Strip the parenthetical portion of a display name.
 * "John Doe (Johnny)" -> "John Doe"
 */
function stripParenthetical(displayName: string): string {
	return displayName.replace(/\s*\(.*?\)\s*$/, "").trim();
}

/**
 * Score a single candidate against a normalized query.
 * Returns the highest applicable score and corresponding match reason.
 */
function scoreCandidate(
	normalizedQuery: string,
	candidate: ContactResolutionSummary,
): { score: number; matchReason: MatchReason } | null {
	const displayNameLower = candidate.displayName.toLowerCase();
	const strippedDisplayNameLower = stripParenthetical(candidate.displayName).toLowerCase();
	const aliasesLower = candidate.aliases.map((a) => a.toLowerCase());

	let bestScore = 0;
	let bestReason: MatchReason = "partial_match";

	// Priority 1: Exact displayName match (full or stripped parenthetical)
	if (normalizedQuery === displayNameLower || normalizedQuery === strippedDisplayNameLower) {
		return { score: 1.0, matchReason: "exact_display_name" };
	}

	// Priority 2: Exact first+last name from aliases (two-word query)
	const queryParts = normalizedQuery.split(/\s+/);
	if (queryParts.length >= 2) {
		const queryFirst = queryParts[0];
		const queryLast = queryParts[queryParts.length - 1];
		const hasFirst = aliasesLower.includes(queryFirst);
		const hasLast = aliasesLower.includes(queryLast);
		if (hasFirst && hasLast) {
			if (0.95 > bestScore) {
				bestScore = 0.95;
				bestReason = "exact_first_name";
			}
		}
	}

	// Priority 3: Relationship label match with kinship normalization
	// Check entire query first, then check individual words for compound queries
	const relationshipScore = scoreRelationship(normalizedQuery, candidate.relationshipLabels);
	if (relationshipScore > 0 && 0.9 > bestScore) {
		bestScore = 0.9;
		bestReason = "relationship_label_match";
	}

	// For compound queries, also check individual words for relationship matches
	if (queryParts.length >= 2) {
		for (const part of queryParts) {
			const partRelScore = scoreRelationship(part, candidate.relationshipLabels);
			if (partRelScore > 0 && 0.9 > bestScore) {
				bestScore = 0.9;
				bestReason = "relationship_label_match";
			}
		}
	}

	// Priority 4: Exact single alias match
	if (aliasesLower.includes(normalizedQuery)) {
		if (0.8 > bestScore) {
			bestScore = 0.8;
			bestReason = "alias_match";
		}
	}

	// For compound queries, also check individual words as alias matches
	if (queryParts.length >= 2) {
		for (const part of queryParts) {
			if (part.length >= MIN_PREFIX_LENGTH && aliasesLower.includes(part)) {
				if (0.8 > bestScore) {
					bestScore = 0.8;
					bestReason = "alias_match";
				}
			}
		}
	}

	// Priority 5: Prefix match (minimum 2 chars)
	if (normalizedQuery.length >= MIN_PREFIX_LENGTH) {
		for (const alias of aliasesLower) {
			if (alias.startsWith(normalizedQuery) && alias !== normalizedQuery) {
				if (0.6 > bestScore) {
					bestScore = 0.6;
					bestReason = "partial_match";
				}
			}
		}
		// Also check display name prefix
		if (
			strippedDisplayNameLower.startsWith(normalizedQuery) &&
			strippedDisplayNameLower !== normalizedQuery
		) {
			if (0.6 > bestScore) {
				bestScore = 0.6;
				bestReason = "partial_match";
			}
		}
	}

	if (bestScore === 0) {
		return null;
	}

	return { score: bestScore, matchReason: bestReason };
}

/**
 * Check if a query term matches any relationship label via kinship normalization.
 */
function scoreRelationship(term: string, labels: string[]): number {
	if (labels.length === 0) return 0;

	const normalizedLabels = labels.map((l) => l.toLowerCase());

	// Direct match: the term itself is a label
	if (normalizedLabels.includes(term)) return 1;

	// Kinship normalization: map the term to Monica labels (direct + inverse)
	const mappedLabels = KINSHIP_MAP.get(term);
	if (mappedLabels && mappedLabels.some((label) => normalizedLabels.includes(label))) return 1;

	return 0;
}

/**
 * Deterministic contact matching algorithm.
 *
 * Takes a natural-language contact reference query and a list of
 * ContactResolutionSummary candidates, and returns scored matches
 * sorted by score descending, then by lastInteractionAt descending
 * (nulls last), then by contactId ascending.
 *
 * This is a pure function with no side effects.
 */
export function matchContacts(
	query: string,
	candidates: ContactResolutionSummary[],
): ContactMatchCandidate[] {
	const normalizedQuery = normalizeQuery(query);
	if (normalizedQuery.length === 0) {
		return [];
	}

	const scored: ContactMatchCandidate[] = [];

	for (const candidate of candidates) {
		const result = scoreCandidate(normalizedQuery, candidate);
		if (result) {
			scored.push({
				contactId: candidate.contactId,
				displayName: candidate.displayName,
				score: result.score,
				matchReason: result.matchReason,
			});
		}
	}

	// Sort: score desc, lastInteractionAt desc (nulls last), contactId asc
	const candidateMap = new Map(candidates.map((c) => [c.contactId, c]));

	scored.sort((a, b) => {
		// 1. Score descending
		if (b.score !== a.score) return b.score - a.score;

		// 2. lastInteractionAt descending (nulls last)
		const aDate = candidateMap.get(a.contactId)?.lastInteractionAt;
		const bDate = candidateMap.get(b.contactId)?.lastInteractionAt;

		if (aDate !== null && bDate !== null && aDate !== undefined && bDate !== undefined) {
			const cmp = bDate.localeCompare(aDate);
			if (cmp !== 0) return cmp;
		} else if (aDate !== null && aDate !== undefined) {
			return -1; // a has date, b doesn't -> a first
		} else if (bDate !== null && bDate !== undefined) {
			return 1; // b has date, a doesn't -> b first
		}

		// 3. contactId ascending
		return a.contactId - b.contactId;
	});

	return scored;
}
