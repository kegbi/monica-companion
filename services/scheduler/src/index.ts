import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", service: "scheduler" }));

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 3005 }, (info) => {
	console.log(`scheduler listening on :${info.port}`);
});
