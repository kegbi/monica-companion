import { describe, expect, it, vi } from "vitest";
import { MonicaPaginationCapError } from "../errors.js";
import { paginateAll } from "../pagination.js";

function makePage<T>(data: T[], currentPage: number, lastPage: number) {
	return {
		data,
		links: {
			first: "https://example.test?page=1",
			last: `https://example.test?page=${lastPage}`,
			prev: currentPage > 1 ? `https://example.test?page=${currentPage - 1}` : null,
			next: currentPage < lastPage ? `https://example.test?page=${currentPage + 1}` : null,
		},
		meta: {
			current_page: currentPage,
			from: currentPage === 1 ? 1 : null,
			last_page: lastPage,
			links: [],
			path: "https://example.test",
			per_page: 100,
			to: data.length,
			total: data.length * lastPage,
		},
	};
}

describe("paginateAll", () => {
	it("returns data from a single page", async () => {
		const fetchPage = vi.fn().mockResolvedValue(makePage([1, 2, 3], 1, 1));

		const result = await paginateAll(fetchPage);

		expect(result).toEqual([1, 2, 3]);
		expect(fetchPage).toHaveBeenCalledOnce();
		expect(fetchPage).toHaveBeenCalledWith(1);
	});

	it("fetches all pages in order for multi-page results", async () => {
		const fetchPage = vi.fn().mockImplementation((page: number) => {
			if (page === 1) return Promise.resolve(makePage(["a", "b"], 1, 3));
			if (page === 2) return Promise.resolve(makePage(["c", "d"], 2, 3));
			if (page === 3) return Promise.resolve(makePage(["e"], 3, 3));
			throw new Error(`Unexpected page: ${page}`);
		});

		const result = await paginateAll(fetchPage);

		expect(result).toEqual(["a", "b", "c", "d", "e"]);
		expect(fetchPage).toHaveBeenCalledTimes(3);
		expect(fetchPage).toHaveBeenCalledWith(1);
		expect(fetchPage).toHaveBeenCalledWith(2);
		expect(fetchPage).toHaveBeenCalledWith(3);
	});

	it("throws MonicaPaginationCapError when page count exceeds cap", async () => {
		const fetchPage = vi.fn().mockResolvedValue(makePage([1], 1, 100));

		await expect(paginateAll(fetchPage, { maxPages: 5 })).rejects.toThrow(MonicaPaginationCapError);
		expect(fetchPage).toHaveBeenCalledOnce();
	});

	it("handles empty results (total = 0)", async () => {
		const fetchPage = vi.fn().mockResolvedValue({
			data: [],
			links: {
				first: "https://example.test?page=1",
				last: "https://example.test?page=1",
				prev: null,
				next: null,
			},
			meta: {
				current_page: 1,
				from: null,
				last_page: 1,
				links: [],
				path: "https://example.test",
				per_page: 100,
				to: null,
				total: 0,
			},
		});

		const result = await paginateAll(fetchPage);

		expect(result).toEqual([]);
		expect(fetchPage).toHaveBeenCalledOnce();
	});

	it("uses default maxPages of 50", async () => {
		const fetchPage = vi.fn().mockResolvedValue(makePage([1], 1, 51));

		await expect(paginateAll(fetchPage)).rejects.toThrow(MonicaPaginationCapError);
	});

	it("respects custom maxPages", async () => {
		const fetchPage = vi.fn().mockImplementation((page: number) => {
			return Promise.resolve(makePage([page], page, 3));
		});

		const result = await paginateAll(fetchPage, { maxPages: 3 });
		expect(result).toEqual([1, 2, 3]);
	});
});
