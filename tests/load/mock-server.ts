/**
 * Mock HTTP server for load testing.
 *
 * Simulates downstream services (monica-integration, delivery, user-management)
 * with configurable response delay via RESPONSE_DELAY_MS environment variable.
 *
 * Usage:
 *   RESPONSE_DELAY_MS=100 npx tsx tests/load/mock-server.ts
 *
 * Defaults to 50ms delay if RESPONSE_DELAY_MS is not set.
 * Listens on MOCK_PORT (default 9999).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const RESPONSE_DELAY_MS = Number.parseInt(process.env.RESPONSE_DELAY_MS ?? "50", 10);
const MOCK_PORT = Number.parseInt(process.env.MOCK_PORT ?? "9999", 10);

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
	await delay(RESPONSE_DELAY_MS);

	const url = req.url ?? "/";

	// Health check (immediate, no delay)
	if (url === "/health") {
		jsonResponse(res, 200, { status: "ok", service: "mock-server" });
		return;
	}

	// Monica-integration: contact creation
	if (url.startsWith("/internal/contacts") && req.method === "POST") {
		jsonResponse(res, 201, { id: 42, object: "contact" });
		return;
	}

	// Monica-integration: note creation
	if (url.startsWith("/internal/contacts") && url.includes("/notes") && req.method === "POST") {
		jsonResponse(res, 201, { id: 100, object: "note" });
		return;
	}

	// Monica-integration: upcoming reminders
	if (url.startsWith("/internal/reminders/upcoming")) {
		jsonResponse(res, 200, {
			data: [
				{
					reminderId: 1,
					plannedDate: new Date().toISOString().split("T")[0],
					title: "Birthday",
					description: "Send birthday wishes",
					contactId: 42,
					contactName: "Jane Doe",
				},
			],
		});
		return;
	}

	// Monica-integration: contact resolution (read-only)
	if (url.startsWith("/internal/contacts/resolve")) {
		jsonResponse(res, 200, {
			data: [
				{
					contactId: 42,
					displayName: "Jane Doe",
					aliases: [],
					relationshipLabels: [],
					importantDates: [],
					lastInteractionAt: null,
				},
			],
		});
		return;
	}

	// Delivery: outbound message intent
	if (url.startsWith("/internal/deliver") && req.method === "POST") {
		jsonResponse(res, 200, { ok: true, deliveryId: "dlv-mock-1" });
		return;
	}

	// User-management: user schedules
	if (url.startsWith("/internal/schedules")) {
		jsonResponse(res, 200, { data: [] });
		return;
	}

	// Catch-all
	jsonResponse(res, 200, { ok: true });
}

const server = createServer((req, res) => {
	handleRequest(req, res).catch((err) => {
		console.error("Mock server error:", err);
		jsonResponse(res, 500, { error: "Internal mock error" });
	});
});

server.listen(MOCK_PORT, () => {
	console.log(`Mock server listening on :${MOCK_PORT} (response delay: ${RESPONSE_DELAY_MS}ms)`);
});

process.on("SIGTERM", () => {
	server.close();
	process.exit(0);
});
process.on("SIGINT", () => {
	server.close();
	process.exit(0);
});
