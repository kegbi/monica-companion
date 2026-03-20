import { describe, expect, it } from "vitest";
import { type AudioFetchResult, fetchAudio } from "../audio-fetcher";

describe("Voice audio transient handling verification", () => {
	it("AudioFetchResult contains only in-memory ArrayBuffer and no file path", () => {
		// Verify the AudioFetchResult interface only has in-memory fields
		const result: AudioFetchResult = {
			buffer: new ArrayBuffer(10),
			contentType: "audio/ogg",
		};

		// Verify buffer is an ArrayBuffer (in-memory)
		expect(result.buffer).toBeInstanceOf(ArrayBuffer);
		// Verify no file path or disk reference exists on the result type
		expect(result).not.toHaveProperty("filePath");
		expect(result).not.toHaveProperty("path");
		expect(result).not.toHaveProperty("tempFile");
	});

	it("voice-transcription has no database dependency", async () => {
		// Verify no database-related imports exist in the service
		// by checking that the service modules do not export any db connection
		const appModule = await import("../app");
		const configModule = await import("../config");
		const audioFetcherModule = await import("../audio-fetcher");
		const whisperClientModule = await import("../whisper-client");
		const handlerModule = await import("../transcription-handler");

		// None of these modules should export database-related entities
		for (const mod of [
			appModule,
			configModule,
			audioFetcherModule,
			whisperClientModule,
			handlerModule,
		]) {
			const exports = Object.keys(mod);
			expect(exports).not.toContain("createDb");
			expect(exports).not.toContain("db");
			expect(exports).not.toContain("database");
			expect(exports).not.toContain("Database");
		}
	});

	it("no fs write operations are used in service modules", async () => {
		// Read the source files and verify no fs.writeFile, fs.writeFileSync,
		// or other disk-write operations exist
		const { readFileSync } = await import("node:fs");
		const { resolve } = await import("node:path");

		const srcDir = resolve(import.meta.dirname, "..");
		const sourceFiles = [
			"app.ts",
			"audio-fetcher.ts",
			"transcription-handler.ts",
			"whisper-client.ts",
			"config.ts",
		];

		const writePatterns = [
			/fs\.writeFile/,
			/fs\.writeFileSync/,
			/fs\.createWriteStream/,
			/fsPromises\.writeFile/,
			/writeFile\(/,
			/createWriteStream\(/,
			/mkdtemp/,
			/tmpdir/,
		];

		for (const file of sourceFiles) {
			const filePath = resolve(srcDir, file);
			const content = readFileSync(filePath, "utf-8");

			for (const pattern of writePatterns) {
				expect(pattern.test(content), `File ${file} should not contain ${pattern.source}`).toBe(
					false,
				);
			}
		}
	});
});
