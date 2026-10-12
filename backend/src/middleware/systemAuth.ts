import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getDb, schema } from "../db/client";
import { sha256Hex } from "../services/crypto";
import type { SysApp } from "../types";

// Server-to-server only: the calling system's backend holds the key and
// vouches for the reporter via X-Reporter-Id. Browsers never see the key.
export const systemAuth = createMiddleware<SysApp>(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key) return c.json({ error: "Missing API key" }, 401);

  const db = getDb(c.env);
  const [system] = await db
    .select({ code: schema.systems.code })
    .from(schema.systems)
    .where(and(eq(schema.systems.apiKeyHash, await sha256Hex(key)), eq(schema.systems.active, 1)))
    .limit(1);
  if (!system) return c.json({ error: "Invalid API key" }, 401);

  const reporterId = (c.req.header("X-Reporter-Id") ?? "").trim();
  if (!reporterId) return c.json({ error: "Missing X-Reporter-Id" }, 400);

  c.set("systemCode", system.code);
  c.set("reporterId", reporterId);
  await next();
});
