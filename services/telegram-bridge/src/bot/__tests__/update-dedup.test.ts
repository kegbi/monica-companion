import { describe, expect, it, vi } from "vitest";
import { UpdateDedup } from "../update-dedup";

function createMockRedis(store: Map<string, string> = new Map()) {
	return {
		set: vi.fn(async (key: string, value: string, exMode: string, ttl: number) => {
			if (store.has(key)) return null;
			store.set(key, value);
			return "OK";
		}),
	};
}

describe("UpdateDedup", () => {
	it("returns false for a new update_id", async () => {
		const redis = createMockRedis();
		const dedup = new UpdateDedup(redis as never);
		const result = await dedup.isDuplicate(12345);
		expect(result).toBe(false);
		expect(redis.set).toHaveBeenCalledWith("tg:dedup:12345", "1", "EX", 60, "NX");
	});

	it("returns true for a seen update_id", async () => {
		const store = new Map<string, string>();
		store.set("tg:dedup:99999", "1");
		const redis = createMockRedis(store);
		const dedup = new UpdateDedup(redis as never);
		const result = await dedup.isDuplicate(99999);
		expect(result).toBe(true);
	});

	it("degrades gracefully when Redis is unavailable", async () => {
		const redis = {
			set: vi.fn(async () => {
				throw new Error("Connection refused");
			}),
		};
		const dedup = new UpdateDedup(redis as never);
		const result = await dedup.isDuplicate(11111);
		// Prefers availability over strict dedup
		expect(result).toBe(false);
	});
});
