import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", service: "user-management" }));

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 3007 }, (info) => {
	console.log(`user-management listening on :${info.port}`);
});
