import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createWebhookHandler } from "../webhook-handler";

describe("createWebhookHandler", () => {
	it("calls bot.handleUpdate for a new update and returns 200", async () => {
		const mockBot = {
			handleUpdate: vi.fn(async () => {}),
		};
		const mockDedup = {
			isDuplicate: vi.fn(async () => false),
		};

		const app = new Hono();
		app.post("/webhook", createWebhookHandler(mockBot as never, mockDedup as never));

		const update = { update_id: 1, message: { text: "hi" } };
		const res = await app.request("/webhook", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(update),
		});

		expect(res.status).toBe(200);
		expect(mockBot.handleUpdate).toHaveBeenCalledWith(update);
		expect(mockDedup.isDuplicate).toHaveBeenCalledWith(1);
	});

	it("skips processing for duplicate update_id and returns 200", async () => {
		const mockBot = {
			handleUpdate: vi.fn(async () => {}),
		};
		const mockDedup = {
			isDuplicate: vi.fn(async () => true),
		};

		const app = new Hono();
		app.post("/webhook", createWebhookHandler(mockBot as never, mockDedup as never));

		const res = await app.request("/webhook", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ update_id: 42 }),
		});

		expect(res.status).toBe(200);
		expect(mockBot.handleUpdate).not.toHaveBeenCalled();
	});

	it("returns 200 even if bot.handleUpdate throws", async () => {
		const mockBot = {
			handleUpdate: vi.fn(async () => {
				throw new Error("Processing failed");
			}),
		};
		const mockDedup = {
			isDuplicate: vi.fn(async () => false),
		};

		const app = new Hono();
		app.post("/webhook", createWebhookHandler(mockBot as never, mockDedup as never));

		const res = await app.request("/webhook", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ update_id: 99 }),
		});

		// Always return 200 to Telegram
		expect(res.status).toBe(200);
	});
});
