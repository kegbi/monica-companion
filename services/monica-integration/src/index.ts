import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", service: "monica-integration" }));

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 3004 }, (info) => {
	console.log(`monica-integration listening on :${info.port}`);
});
