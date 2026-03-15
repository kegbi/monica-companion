import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", service: "telegram-bridge" }));

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 3001 }, (info) => {
	console.log(`telegram-bridge listening on :${info.port}`);
});
