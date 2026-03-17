import { serviceAuth } from "@monica-companion/auth";
import { otelMiddleware } from "@monica-companion/observability";
import { TranscriptionRequestMetadataSchema } from "@monica-companion/types";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Config } from "./config";

export function createApp(config: Config) {
	const app = new Hono();

	app.use(otelMiddleware());

	app.get("/health", (c) => c.json({ status: "ok", service: "voice-transcription" }));

	const internal = new Hono();
	internal.use(
		serviceAuth({
			audience: "voice-transcription",
			secrets: config.auth.jwtSecrets,
			allowedCallers: ["telegram-bridge"],
		}),
	);

	// 25MB body limit per plan [LOW-1 fix]
	internal.use(bodyLimit({ maxSize: 25 * 1024 * 1024 }));

	internal.post("/transcribe", async (c) => {
		let formData: FormData;
		try {
			formData = await c.req.formData();
		} catch {
			return c.json({ error: "Invalid multipart request" }, 400);
		}

		const metadataRaw = formData.get("metadata");
		if (typeof metadataRaw !== "string") {
			return c.json({ error: "Missing metadata field" }, 400);
		}

		let metadataParsed: unknown;
		try {
			metadataParsed = JSON.parse(metadataRaw);
		} catch {
			return c.json({ error: "Invalid metadata JSON" }, 400);
		}

		const metadataResult = TranscriptionRequestMetadataSchema.safeParse(metadataParsed);
		if (!metadataResult.success) {
			return c.json({ error: "Invalid metadata" }, 400);
		}

		// Stub: transcription not yet implemented
		return c.json({
			success: false,
			error: "Transcription not implemented",
			correlationId: metadataResult.data.correlationId,
		});
	});

	app.route("/internal", internal);

	return app;
}
