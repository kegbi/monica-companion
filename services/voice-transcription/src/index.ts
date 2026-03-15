import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", service: "voice-transcription" }));

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 3003 }, (info) => {
	console.log(`voice-transcription listening on :${info.port}`);
});
