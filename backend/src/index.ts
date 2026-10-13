import { and, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "./db/client";
import auth from "./routes/auth";
import dev from "./routes/dev";
import sys from "./routes/sys";
import { notifyTicketsChanged } from "./live";
import { nowIso } from "./services/tickets";
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
  const tickets = schema.tickets;
  const cutoff = new Date(Date.now() - AUTO_CLOSE_DAYS * 86400_000).toISOString();
  const closedAt = nowIso();
  const closedTickets = await db
    .update(tickets)
    .set({ status: "closed", closedAt, lastPublicActivityAt: closedAt, lastPublicActor: "system", updatedAt: closedAt })
    .where(and(eq(tickets.status, "resolved"), lt(tickets.resolvedAt, cutoff)))
    .returning({ id: tickets.id });
  if (!closedTickets.length) return;

  await db.insert(schema.ticketEvents).values(
    closedTickets.map(({ id }) => ({
      ticketId: id,
      kind: "status" as const,
      visibility: "public" as const,
      authorKind: "system" as const,
      authorName: "System",
      body: `Closed automatically after ${AUTO_CLOSE_DAYS} days in Resolved.`,
      fromValue: "resolved",
      toValue: "closed",
      createdAt: closedAt,
    })),
  );
  await notifyTicketsChanged(env.LIVE);
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(autoCloseResolved(env));
  },
} satisfies ExportedHandler<Env>;
