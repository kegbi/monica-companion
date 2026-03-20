import { describe, expect, it, vi } from "vitest";
import { disconnectUser } from "../disconnect.js";

function createMockTx() {
	const updateWhere = vi.fn().mockResolvedValue({ rowCount: 1 });
	const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
	const insertValues = vi.fn().mockResolvedValue([]);

	return {
		update: vi.fn().mockReturnValue({ set: updateSet }),
		insert: vi.fn().mockReturnValue({ values: insertValues }),
		select: vi.fn().mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([
						{
							id: "user-uuid-1",
							telegramUserId: "12345",
							monicaBaseUrl: "https://monica.example.com",
							monicaApiTokenEncrypted: "encrypted-token",
							encryptionKeyId: "key-1",
						},
					]),
				}),
			}),
		}),
		_updateSet: updateSet,
		_updateWhere: updateWhere,
		_insertValues: insertValues,
	};
}

function createMockDb() {
	const mockTx = createMockTx();
	return {
		transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
			return fn(mockTx);
		}),
		_tx: mockTx,
	};
}

describe("disconnectUser", () => {
	it("returns purgeScheduledAt on success", async () => {
		const db = createMockDb();
		const result = await disconnectUser(db as never, {
			userId: "user-uuid-1",
			actorService: "telegram-bridge",
			correlationId: "corr-1",
		});
		expect(result).not.toBeNull();
		expect(result!.purgeScheduledAt).toBeInstanceOf(Date);
	});

	it("returns null when user is not found", async () => {
		const tx = createMockTx();
		tx.select = vi.fn().mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([]),
				}),
			}),
		});

		const db = {
			transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
		};

		const result = await disconnectUser(db as never, {
			userId: "nonexistent",
			actorService: "telegram-bridge",
			correlationId: "corr-1",
		});
		expect(result).toBeNull();
	});

	it("calls update, insert within a single transaction", async () => {
		const db = createMockDb();
		await disconnectUser(db as never, {
			userId: "user-uuid-1",
			actorService: "telegram-bridge",
			correlationId: "corr-1",
		});
		expect(db.transaction).toHaveBeenCalledTimes(1);
		// tx.update called for revoking credentials and invalidating tokens
		expect(db._tx.update).toHaveBeenCalled();
		// tx.insert called for purge request and audit log
		expect(db._tx.insert).toHaveBeenCalled();
	});
});
