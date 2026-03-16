import type { FullContact } from "@monica-companion/monica-api-lib";
import { ContactResolutionSummary } from "@monica-companion/types";
import type { z } from "zod/v4";

type FullContactType = z.infer<typeof FullContact>;
type ContactResolutionSummaryType = z.infer<typeof ContactResolutionSummary>;

/**
 * Transform a raw Monica FullContact into a Monica-agnostic ContactResolutionSummary.
 * This is the anti-corruption boundary between Monica data and ai-router's domain.
 */
export function buildContactResolutionSummary(
	contact: FullContactType,
): ContactResolutionSummaryType {
	const aliases = buildAliases(contact);
	const relationshipLabels = contact.is_partial ? [] : buildRelationshipLabels(contact);
	const importantDates = buildImportantDates(contact);

	const summary = {
		contactId: contact.id,
		displayName: contact.complete_name,
		aliases,
		relationshipLabels,
		importantDates,
		lastInteractionAt: contact.last_activity_together,
	};

	// Validate output against schema for safety
	return ContactResolutionSummary.parse(summary);
}

/**
 * Transform an array of FullContacts into ContactResolutionSummary[].
 */
export function buildContactResolutionSummaries(
	contacts: FullContactType[],
): ContactResolutionSummaryType[] {
	return contacts.map(buildContactResolutionSummary);
}

function buildAliases(contact: FullContactType): string[] {
	const candidates = [contact.nickname, contact.first_name, contact.last_name];

	const deduplicated = new Set<string>();
	for (const name of candidates) {
		if (name && name !== contact.complete_name) {
			deduplicated.add(name);
		}
	}

	return Array.from(deduplicated);
}

function buildRelationshipLabels(contact: FullContactType): string[] {
	const groups = contact.information.relationships;
	const labels: string[] = [];

	for (const group of [groups.love, groups.family, groups.friend, groups.work]) {
		for (const entry of group.contacts) {
			labels.push(entry.relationship.name);
		}
	}

	return labels;
}

function buildImportantDates(
	contact: FullContactType,
): z.infer<typeof import("@monica-companion/types").ImportantDate>[] {
	const dates: z.infer<typeof import("@monica-companion/types").ImportantDate>[] = [];
	const birthdate = contact.information.dates.birthdate;

	if (birthdate.date) {
		// Extract the date portion (YYYY-MM-DD) from the ISO datetime string
		const datePortion = birthdate.date.split("T")[0];
		dates.push({
			label: "birthdate",
			date: datePortion,
			isYearUnknown: birthdate.is_year_unknown ?? false,
		});
	}

	return dates;
}
