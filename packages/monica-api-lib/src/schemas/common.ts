import { z } from "zod/v4";

/** Embedded account reference found in all Monica resources. */
export const AccountRef = z.object({
	id: z.number().int(),
});
export type AccountRef = z.infer<typeof AccountRef>;

/** Date field used in contact information (birthdate, deceased_date, first_met_date). */
export const MonicaDateField = z.object({
	is_age_based: z.boolean().nullable(),
	is_year_unknown: z.boolean().nullable(),
	date: z.string().nullable(),
});
export type MonicaDateField = z.infer<typeof MonicaDateField>;

/** Avatar information embedded in contact objects. */
export const Avatar = z.object({
	url: z.string(),
	source: z.string(),
	default_avatar_color: z.string(),
});
export type Avatar = z.infer<typeof Avatar>;

/** Single link entry within pagination meta. */
export const PaginationMetaLink = z.object({
	url: z.string().nullable(),
	label: z.string(),
	active: z.boolean(),
});
export type PaginationMetaLink = z.infer<typeof PaginationMetaLink>;

/** Pagination links section. */
export const PaginationLinks = z.object({
	first: z.string(),
	last: z.string(),
	prev: z.string().nullable(),
	next: z.string().nullable(),
});
export type PaginationLinks = z.infer<typeof PaginationLinks>;

/** Pagination meta section. */
export const PaginationMeta = z.object({
	current_page: z.number().int(),
	from: z.number().int().nullable(),
	last_page: z.number().int(),
	links: z.array(PaginationMetaLink),
	path: z.string(),
	per_page: z.number().int(),
	to: z.number().int().nullable(),
	total: z.number().int(),
});
export type PaginationMeta = z.infer<typeof PaginationMeta>;

/** Generic paginated response envelope. */
export function PaginatedResponse<T extends z.ZodType>(itemSchema: T) {
	return z.object({
		data: z.array(itemSchema),
		links: PaginationLinks,
		meta: PaginationMeta,
	});
}

/** Standard delete response. */
export const DeleteResponse = z.object({
	deleted: z.boolean(),
	id: z.number().int(),
});
export type DeleteResponse = z.infer<typeof DeleteResponse>;

/** Standard error response. Message can be a string or array of strings. */
export const ErrorResponse = z.object({
	error: z.object({
		message: z.union([z.string(), z.array(z.string())]),
		error_code: z.number().int(),
	}),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
