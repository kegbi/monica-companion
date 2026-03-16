import { z } from "zod/v4";
import { MonicaApiError, MonicaNetworkError } from "./errors.js";
import type { StructuredLogger } from "./logger-interface.js";
import { paginateAll } from "./pagination.js";
import {
	Activity,
	Address,
	ContactField,
	ContactFieldType,
	CreateActivityRequest,
	CreateAddressRequest,
	CreateContactFieldRequest,
	CreateContactRequest,
	CreateNoteRequest,
	CreateReminderRequest,
	FullContact,
	Gender,
	Note,
	PaginatedResponse,
	Reminder,
	ReminderOutbox,
	UpdateContactCareerRequest,
} from "./schemas/index.js";
import { type RetryOptions, withRetry, withTimeout } from "./transport.js";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Options for creating a MonicaApiClient. */
export interface MonicaApiClientOptions {
	/** Monica instance base URL (e.g., "https://app.monicahq.com"). */
	baseUrl: string;
	/** Monica API token (Bearer token). */
	apiToken: string;
	/** Custom fetch function (for testing). Defaults to globalThis.fetch. */
	fetch?: FetchFn;
	/** Request timeout in milliseconds. Default: 10000. */
	timeoutMs?: number;
	/** Retry options. */
	retryOptions?: Partial<RetryOptions>;
	/** Structured logger (info, warn, error, debug). */
	logger?: StructuredLogger;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
	maxRetries: 2,
	baseDelayMs: 500,
	maxDelayMs: 5000,
};

/** Helper to create a { data: T } envelope schema for single-resource endpoints. */
function singleEnvelope<T extends z.ZodType>(schema: T) {
	return z.object({ data: schema });
}

/** Normalize a base URL: strip trailing slash, ensure /api suffix. */
function normalizeBaseUrl(url: string): string {
	let normalized = url.replace(/\/+$/, "");
	if (!normalized.endsWith("/api")) {
		normalized = `${normalized}/api`;
	}
	return normalized;
}

/**
 * Typed HTTP client for the Monica v4 API.
 * Wraps every endpoint with Zod validation, timeout, and retry handling.
 * Instantiated per-request by monica-integration after credential resolution.
 */
export class MonicaApiClient {
	private readonly baseApiUrl: string;
	private readonly apiToken: string;
	private readonly fetchFn: FetchFn;
	private readonly retryOptions: RetryOptions;
	private readonly logger?: StructuredLogger;

	constructor(options: MonicaApiClientOptions) {
		this.baseApiUrl = normalizeBaseUrl(options.baseUrl);
		this.apiToken = options.apiToken;
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const rawFetch = options.fetch ?? globalThis.fetch;
		this.fetchFn = withTimeout(rawFetch, timeoutMs);
		this.retryOptions = {
			...DEFAULT_RETRY_OPTIONS,
			...options.retryOptions,
		};
		this.logger = options.logger;
	}

	// ── Read operations ─────────────────────────────────────────────────

	async listContacts(options?: {
		page?: number;
		limit?: number;
		sort?: string;
		query?: string;
	}): Promise<z.infer<ReturnType<typeof PaginatedResponse<typeof FullContact>>>> {
		const params = new URLSearchParams();
		if (options?.page) params.set("page", String(options.page));
		if (options?.limit) params.set("limit", String(options.limit));
		if (options?.sort) params.set("sort", options.sort);
		if (options?.query) params.set("query", options.query);

		const qs = params.toString();
		const path = qs ? `/contacts?${qs}` : "/contacts";
		const response = await this.request("GET", path);
		const body = await response.json();
		return PaginatedResponse(FullContact).parse(body);
	}

	async getContact(id: number): Promise<z.infer<typeof FullContact>> {
		const response = await this.request("GET", `/contacts/${id}`);
		const body = await response.json();
		const envelope = singleEnvelope(FullContact).parse(body);
		return envelope.data;
	}

	async getAllContacts(): Promise<z.infer<typeof FullContact>[]> {
		return paginateAll(async (page) => {
			const result = await this.listContacts({ page, limit: 100 });
			return result;
		});
	}

	async listContactNotes(
		contactId: number,
		options?: { page?: number; limit?: number },
	): Promise<z.infer<ReturnType<typeof PaginatedResponse<typeof Note>>>> {
		const params = new URLSearchParams();
		if (options?.page) params.set("page", String(options.page));
		if (options?.limit) params.set("limit", String(options.limit));

		const qs = params.toString();
		const path = qs ? `/contacts/${contactId}/notes?${qs}` : `/contacts/${contactId}/notes`;
		const response = await this.request("GET", path);
		const body = await response.json();
		return PaginatedResponse(Note).parse(body);
	}

	async getUpcomingReminders(monthOffset: number): Promise<z.infer<typeof ReminderOutbox>[]> {
		return paginateAll(async (page) => {
			const params = new URLSearchParams({ page: String(page) });
			const response = await this.request(
				"GET",
				`/reminders/upcoming/${monthOffset}?${params.toString()}`,
			);
			const body = await response.json();
			return PaginatedResponse(ReminderOutbox).parse(body);
		});
	}

	async listGenders(): Promise<z.infer<typeof Gender>[]> {
		return paginateAll(async (page) => {
			const params = new URLSearchParams({ page: String(page) });
			const response = await this.request("GET", `/genders?${params.toString()}`);
			const body = await response.json();
			return PaginatedResponse(Gender).parse(body);
		});
	}

	async listContactFieldTypes(): Promise<z.infer<typeof ContactFieldType>[]> {
		return paginateAll(async (page) => {
			const params = new URLSearchParams({ page: String(page) });
			const response = await this.request("GET", `/contactfieldtypes?${params.toString()}`);
			const body = await response.json();
			return PaginatedResponse(ContactFieldType).parse(body);
		});
	}

	async listContactAddresses(contactId: number): Promise<z.infer<typeof Address>[]> {
		return paginateAll(async (page) => {
			const params = new URLSearchParams({ page: String(page) });
			const response = await this.request(
				"GET",
				`/contacts/${contactId}/addresses?${params.toString()}`,
			);
			const body = await response.json();
			return PaginatedResponse(Address).parse(body);
		});
	}

	async getContactWithFields(id: number): Promise<z.infer<typeof FullContact>> {
		const response = await this.request("GET", `/contacts/${id}?with=contactfields`);
		const body = await response.json();
		const envelope = singleEnvelope(FullContact).parse(body);
		return envelope.data;
	}

	// ── Write operations ────────────────────────────────────────────────

	async createContact(
		data: z.infer<typeof CreateContactRequest>,
	): Promise<z.infer<typeof FullContact>> {
		const validated = CreateContactRequest.parse(data);
		const response = await this.request("POST", "/contacts", validated);
		const body = await response.json();
		return singleEnvelope(FullContact).parse(body).data;
	}

	async updateContact(
		id: number,
		data: z.infer<typeof CreateContactRequest>,
	): Promise<z.infer<typeof FullContact>> {
		const validated = CreateContactRequest.parse(data);
		const response = await this.request("PUT", `/contacts/${id}`, validated);
		const body = await response.json();
		return singleEnvelope(FullContact).parse(body).data;
	}

	async updateContactCareer(
		id: number,
		data: z.infer<typeof UpdateContactCareerRequest>,
	): Promise<z.infer<typeof FullContact>> {
		const validated = UpdateContactCareerRequest.parse(data);
		const response = await this.request("PUT", `/contacts/${id}/work`, validated);
		const body = await response.json();
		return singleEnvelope(FullContact).parse(body).data;
	}

	async createNote(data: z.infer<typeof CreateNoteRequest>): Promise<z.infer<typeof Note>> {
		const validated = CreateNoteRequest.parse(data);
		const response = await this.request("POST", "/notes", validated);
		const body = await response.json();
		return singleEnvelope(Note).parse(body).data;
	}

	async createActivity(
		data: z.infer<typeof CreateActivityRequest>,
	): Promise<z.infer<typeof Activity>> {
		const validated = CreateActivityRequest.parse(data);
		const response = await this.request("POST", "/activities", validated);
		const body = await response.json();
		return singleEnvelope(Activity).parse(body).data;
	}

	async createReminder(
		data: z.infer<typeof CreateReminderRequest>,
	): Promise<z.infer<typeof Reminder>> {
		const validated = CreateReminderRequest.parse(data);
		const response = await this.request("POST", "/reminders", validated);
		const body = await response.json();
		return singleEnvelope(Reminder).parse(body).data;
	}

	async createContactField(
		data: z.infer<typeof CreateContactFieldRequest>,
	): Promise<z.infer<typeof ContactField>> {
		const validated = CreateContactFieldRequest.parse(data);
		const response = await this.request("POST", "/contactfields", validated);
		const body = await response.json();
		return singleEnvelope(ContactField).parse(body).data;
	}

	async createAddress(
		data: z.infer<typeof CreateAddressRequest>,
	): Promise<z.infer<typeof Address>> {
		const validated = CreateAddressRequest.parse(data);
		const response = await this.request("POST", "/addresses", validated);
		const body = await response.json();
		return singleEnvelope(Address).parse(body).data;
	}

	// ── Internal helpers ────────────────────────────────────────────────

	private async request(method: string, path: string, body?: unknown): Promise<Response> {
		const url = `${this.baseApiUrl}${path}`;
		const startTime = Date.now();

		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.apiToken}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		};

		const init: RequestInit = { method, headers };
		if (body !== undefined) {
			init.body = JSON.stringify(body);
		}

		try {
			const response = await withRetry(() => this.fetchFn(url, init), this.retryOptions);

			const durationMs = Date.now() - startTime;
			this.logger?.debug("Monica API request completed", {
				method,
				path,
				status: response.status,
				durationMs,
			});

			if (!response.ok) {
				throw await MonicaApiError.fromResponse(response);
			}

			return response;
		} catch (err) {
			if (err instanceof MonicaApiError) {
				throw err;
			}
			if (err instanceof MonicaNetworkError) {
				throw err;
			}
			throw new MonicaNetworkError(err instanceof Error ? err.message : "Unknown network error");
		}
	}
}
