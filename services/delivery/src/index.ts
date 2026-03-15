import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", service: "delivery" }));

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 3006 }, (info) => {
	console.log(`delivery listening on :${info.port}`);
});
