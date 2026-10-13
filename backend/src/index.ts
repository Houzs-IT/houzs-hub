import { and, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "./db/client";
import auth from "./routes/auth";
import dev from "./routes/dev";
import sys from "./routes/sys";
import { addEvent, nowIso } from "./services/tickets";
import type { Env } from "./types";

export { LiveRoom } from "./live";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, service: "houzs-it-hub" }));
app.route("/api/v1/auth", auth);
app.route("/api/v1/sys", sys);
app.route("/api/v1/dev", dev);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

const AUTO_CLOSE_DAYS = 7;

async function autoCloseResolved(env: Env) {
  const db = getDb(env);
  const t = schema.tickets;
  const cutoff = new Date(Date.now() - AUTO_CLOSE_DAYS * 86400_000).toISOString();
  const stale = await db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.status, "resolved"), lt(t.resolvedAt, cutoff)));
  const at = nowIso();
  for (const { id } of stale) {
    await addEvent(db, id, {
      kind: "status",
      visibility: "public",
      authorKind: "system",
      authorName: "System",
      body: `Closed automatically after ${AUTO_CLOSE_DAYS} days in Resolved.`,
      fromValue: "resolved",
      toValue: "closed",
      at,
    });
    await db
      .update(t)
      .set({ status: "closed", closedAt: at, lastPublicActivityAt: at, lastPublicActor: "system", updatedAt: at })
      .where(eq(t.id, id));
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(autoCloseResolved(env));
  },
} satisfies ExportedHandler<Env>;
