import { describe, expect, it, vi } from "vitest";

const mockQuit = vi.fn().mockResolvedValue("OK");

vi.mock("ioredis", () => {
	class MockRedis {
		quit = mockQuit;
		status = "ready";
		constructor(_url: string, _opts?: Record<string, unknown>) {}
	}
	return { default: MockRedis };
});

describe("Redis connection factory", () => {
	it("createRedisClient returns an ioredis instance configured with the given URL", async () => {
		const { createRedisClient } = await import("../redis.js");
		const client = createRedisClient("redis://localhost:6379");
		expect(client).toBeDefined();
		expect(client.status).toBe("ready");
	});

	it("closeRedisClient calls quit() on the client", async () => {
		const { createRedisClient, closeRedisClient } = await import("../redis.js");
		const client = createRedisClient("redis://localhost:6379");
		await closeRedisClient(client);
		expect(mockQuit).toHaveBeenCalled();
	});
});
