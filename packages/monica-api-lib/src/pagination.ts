import { MonicaPaginationCapError } from "./errors.js";

/** Shape of a paginated response page (matches Monica API envelope). */
export interface PaginatedResponsePage<T> {
	data: T[];
	meta: {
		current_page: number;
		last_page: number;
	};
}

export interface PaginateOptions {
	/** Maximum number of pages to fetch. Default: 50. */
	maxPages?: number;
}

/**
 * Fetch all pages of a paginated Monica API endpoint.
 * The fetchPage callback is responsible for making the HTTP request
 * and validating the response for the given page number.
 *
 * Throws MonicaPaginationCapError if the total page count exceeds maxPages.
 */
export async function paginateAll<T>(
	fetchPage: (page: number) => Promise<PaginatedResponsePage<T>>,
	options?: PaginateOptions,
): Promise<T[]> {
	const maxPages = options?.maxPages ?? 50;

	const firstPage = await fetchPage(1);
	const { last_page } = firstPage.meta;

	if (last_page > maxPages) {
		throw new MonicaPaginationCapError(last_page, maxPages);
	}

	const results: T[] = [...firstPage.data];

	for (let page = 2; page <= last_page; page++) {
		const pageResult = await fetchPage(page);
		results.push(...pageResult.data);
	}

	return results;
}
