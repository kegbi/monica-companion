import { signServiceToken } from "@monica-companion/auth";
import { describe, expect, it, vi } from "vitest";
import type { AppDeps } from "../app";
import { createApp } from "../app";

const JWT_SECRET = "test-secret-256-bit-minimum-key!";

const testConfig = {
	telegramBridgeUrl: "http://telegram-bridge:3001",
	databaseUrl: "postgresql://test:test@localhost:5432/test",
	httpTimeoutMs: 10_000,
	auth: {
		serviceName: "delivery" as const,
		jwtSecrets: [JWT_SECRET],
	},
};

const validIntent = {
	userId: "user-uuid-123",
	connectorType: "telegram",
	connectorRoutingId: "chat-12345",
	correlationId: "corr-abc",
	content: { type: "text", text: "Hello!" },
};

function createMockDb() {
	const insertedRows: Array<Record<string, unknown>> = [];
	const updatedRows: Array<{ id: string; data: Record<string, unknown> }> = [];

	return {
		insertedRows,
		updatedRows,
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockImplementation((data: Record<string, unknown>) => {
				const id = "audit-uuid-001";
				insertedRows.push({ ...data, id });
				return {
					returning: vi.fn().mockResolvedValue([{ id }]),
				};
			}),
		}),
		update: vi.fn().mockReturnValue({
			set: vi.fn().mockImplementation((data: Record<string, unknown>) => {
				return {
					where: vi.fn().mockImplementation(() => {
						updatedRows.push({ id: "audit-uuid-001", data });
						return Promise.resolve();
					}),
				};
			}),
		}),
	};
}

function createTestApp(overrides?: {
	fetchFn?: typeof globalThis.fetch;
	db?: ReturnType<typeof createMockDb>;
}) {
	const db = overrides?.db ?? createMockDb();
	const deps: AppDeps = { db: db as never };
	const config = { ...testConfig, fetchFn: overrides?.fetchFn };
	const app = createApp(config, deps);
	return { app, db };
}

describe("delivery app", () => {
	it("GET /health returns 200", async () => {
		const { app } = createTestApp();
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok", service: "delivery" });
	});

	it("POST /internal/deliver returns 401 without auth", async () => {
		const { app } = createTestApp();
		const res = await app.request("/internal/deliver", { method: "POST" });
		expect(res.status).toBe(401);
	});

	it("POST /internal/deliver returns 403 for disallowed caller", async () => {
		const token = await signServiceToken({
			issuer: "telegram-bridge",
			audience: "delivery",
			secret: JWT_SECRET,
		});
		const { app } = createTestApp();
		const res = await app.request("/internal/deliver", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(403);
	});

	it("POST /internal/deliver returns 400 for invalid payload with rejected audit", async () => {
		const token = await signServiceToken({
			issuer: "ai-router",
			audience: "delivery",
			secret: JWT_SECRET,
		});
		const { app } = createTestApp();
		const res = await app.request("/internal/deliver", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ invalid: true }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.status).toBe("rejected");
		expect(body.error).toBeDefined();
	});

	it("POST /internal/deliver returns 400 for unsupported connector with rejected audit", async () => {
		const token = await signServiceToken({
			issuer: "ai-router",
			audience: "delivery",
			secret: JWT_SECRET,
		});
		const { app } = createTestApp();
		const res = await app.request("/internal/deliver", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				...validIntent,
				connectorType: "whatsapp",
			}),
		});
		// Note: will be 400 because OutboundMessageIntentSchema validates connectorType as enum ["telegram"]
		expect(res.status).toBe(400);
	});

	it("POST /internal/deliver returns 200 with delivered audit for valid intent", async () => {
		const token = await signServiceToken({
			issuer: "ai-router",
			audience: "delivery",
			secret: JWT_SECRET,
		});
		const mockFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
		const { app, db } = createTestApp({ fetchFn: mockFetch as never });

		const res = await app.request("/internal/deliver", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(validIntent),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.deliveryId).toBe("audit-uuid-001");
		expect(body.status).toBe("delivered");

		// Verify audit insert was called
		expect(db.insert).toHaveBeenCalled();

		// Verify audit update was called with "delivered" status
		expect(db.updatedRows.length).toBe(1);
		expect(db.updatedRows[0].data.status).toBe("delivered");
		expect(db.updatedRows[0].data.completedAt).toBeDefined();

		// Verify fetch was called to the connector
		expect(mockFetch).toHaveBeenCalled();
		const fetchCall = mockFetch.mock.calls[0];
		expect(fetchCall[0]).toBe("http://telegram-bridge:3001/internal/send");
	});

	it("POST /internal/deliver returns 502 with failed audit on connector failure", async () => {
		const token = await signServiceToken({
			issuer: "ai-router",
			audience: "delivery",
			secret: JWT_SECRET,
		});
		const mockFetch = vi.fn(async () => {
			throw new Error("Connection refused");
		});
		const { app, db } = createTestApp({ fetchFn: mockFetch as never });

		const res = await app.request("/internal/deliver", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(validIntent),
		});
		expect(res.status).toBe(502);
		const body = await res.json();
		expect(body.deliveryId).toBe("audit-uuid-001");
		expect(body.status).toBe("failed");
		expect(body.error).toBeDefined();

		// Verify audit was updated with "failed" status
		expect(db.updatedRows.length).toBe(1);
		expect(db.updatedRows[0].data.status).toBe("failed");
		expect(db.updatedRows[0].data.error).toBeDefined();
	});

	it("POST /internal/deliver accepts scheduler as allowed caller", async () => {
		const token = await signServiceToken({
			issuer: "scheduler",
			audience: "delivery",
			secret: JWT_SECRET,
		});
		const mockFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
		const { app } = createTestApp({ fetchFn: mockFetch as never });

		const res = await app.request("/internal/deliver", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(validIntent),
		});
		expect(res.status).toBe(200);
	});

	it("POST /internal/deliver returns 502 on timeout", async () => {
		const token = await signServiceToken({
			issuer: "ai-router",
			audience: "delivery",
			secret: JWT_SECRET,
		});
		const mockFetch = vi.fn(async () => {
			const error = new DOMException("The operation was aborted", "AbortError");
			throw error;
		});
		const { app, db } = createTestApp({ fetchFn: mockFetch as never });

		const res = await app.request("/internal/deliver", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(validIntent),
		});
		expect(res.status).toBe(502);
		const body = await res.json();
		expect(body.status).toBe("failed");
		expect(body.error).toContain("abort");

		// Verify audit was updated with "failed" status
		expect(db.updatedRows.length).toBe(1);
		expect(db.updatedRows[0].data.status).toBe("failed");
	});

	it("POST /internal/deliver returns 503 when DB insert fails", async () => {
		const token = await signServiceToken({
			issuer: "ai-router",
			audience: "delivery",
			secret: JWT_SECRET,
		});
		const failingDb = {
			insertedRows: [],
			updatedRows: [],
			insert: vi.fn().mockReturnValue({
				values: vi.fn().mockReturnValue({
					returning: vi.fn().mockRejectedValue(new Error("DB connection lost")),
				}),
			}),
			update: vi.fn(),
		};
		const { app } = createTestApp({ db: failingDb as never });

		const res = await app.request("/internal/deliver", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(validIntent),
		});
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error).toContain("unavailable");
	});
});
