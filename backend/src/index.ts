import { and, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "./db/client";
import auth from "./routes/auth";
import dev from "./routes/dev";
import sys from "./routes/sys";
import { notifyTicketsChanged } from "./live";
import { runHealthChecks } from "./services/health";
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

  const events = closedTickets.map(({ id }) => ({
    ticketId: id,
    kind: "status" as const,
    visibility: "public" as const,
    authorKind: "system" as const,
    authorName: "System",
    body: `Closed automatically after ${AUTO_CLOSE_DAYS} days in Resolved.`,
    fromValue: "resolved",
    toValue: "closed",
    createdAt: closedAt,
  }));
  // Chunked: one statement can carry ~65k parameters, and a run after a long outage could close thousands.
  for (let i = 0; i < events.length; i += 1000) await db.insert(schema.ticketEvents).values(events.slice(i, i + 1000));
  await notifyTicketsChanged(env.LIVE);
}

export default {
  fetch: app.fetch,
  // One cron, every 5 minutes, so the hub adds no trigger to its account's quota:
  // health checks run each time, the ticket auto-close once a day at 02:00 UTC (10:00 GMT+8).
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runHealthChecks(getDb(env)));
    const at = new Date(event.scheduledTime);
    if (at.getUTCHours() === 2 && at.getUTCMinutes() < 5) ctx.waitUntil(autoCloseResolved(env));
  },
} satisfies ExportedHandler<Env>;
