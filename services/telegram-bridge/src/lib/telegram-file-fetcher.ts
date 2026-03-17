type FetchFn = typeof globalThis.fetch;

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface FileDownloadResult {
	buffer: ArrayBuffer;
}

/**
 * Downloads files from the Telegram Bot API.
 * Uses getFile to resolve file_id to file_path, then downloads the binary.
 */
export class TelegramFileFetcher {
	private readonly apiBase: string;
	private readonly fetchFn: FetchFn;

	constructor(
		private readonly botToken: string,
		fetchFn?: FetchFn,
	) {
		this.apiBase = `${TELEGRAM_API_BASE}/bot${botToken}`;
		this.fetchFn = fetchFn ?? globalThis.fetch;
	}

	async downloadFile(fileId: string, timeoutMs = 30_000): Promise<FileDownloadResult> {
		const signal = AbortSignal.timeout(timeoutMs);

		// Step 1: Get file path from Telegram
		const getFileRes = await this.fetchFn(`${this.apiBase}/getFile?file_id=${fileId}`, {
			signal,
		});
		if (!getFileRes.ok) {
			throw new Error(`getFile failed with status ${getFileRes.status}`);
		}

		const getFileData = await getFileRes.json();
		if (!getFileData.ok || !getFileData.result?.file_path) {
			throw new Error("getFile returned invalid response");
		}

		// Step 2: Download the file binary
		const fileUrl = `${TELEGRAM_API_BASE}/file/bot${this.botToken}/${getFileData.result.file_path}`;
		const fileRes = await this.fetchFn(fileUrl, { signal });
		if (!fileRes.ok) {
			throw new Error(`File download failed with status ${fileRes.status}`);
		}

		const buffer = await fileRes.arrayBuffer();
		return { buffer };
	}
}
