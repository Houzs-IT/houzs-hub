import { and, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "./db/client";
import auth from "./routes/auth";
import mcp, { mcpWellKnown, setMcpApp } from "./routes/mcp";
import mcpAdmin from "./routes/mcpAdmin";
import proactive from "./routes/proactive";
import groupReport from "./routes/groupReport";
import { MCP_INNER_HEADER, mcpInnerSecret } from "./services/mcp-inner";
import dev from "./routes/dev";
import sys from "./routes/sys";
import sysAiUsage from "./routes/sysAiUsage";
import sysHealth from "./routes/sysHealth";
import { portalMeetings, publicMeetings } from "./routes/portalMeetings";
import { sysMeetings } from "./routes/sysMeetings";
import { sendDueReminders } from "./services/meetingMail";
import sysUsageCosts from "./routes/sysUsageCosts";
import { notifyTicketsChanged } from "./live";
import { runHealthChecks } from "./services/health";
import { sendHealthAlerts } from "./services/healthAlerts";
import { nowIso } from "./services/tickets";
import type { Env } from "./types";
import { syncAnthropicCosts, UsageSetupError } from "./services/anthropicUsage";
import { kickMailSyncs, MAIL_SYNC_TARGETS } from "./services/mailSyncKick";

export { LiveRoom } from "./live";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true, service: "houzs-it-hub" }));
app.route("/api/v1/auth", auth);
// Before the ticket routes: health and usage reports are sent by a system, not on behalf of a person.
app.route("/api/v1/sys/health", sysHealth);
app.route("/api/v1/sys/ai-usage", sysAiUsage);
app.route("/api/v1/sys/usage-costs", sysUsageCosts);
app.route("/api/v1/sys/meetings", sysMeetings);
app.route("/api/v1/sys", sys);
app.route("/api/v1/dev", dev);
// Meetings for IT Support's own users (session) and for guests of a link made here (no sign-in).
app.route("/api/v1/meetings", portalMeetings);
app.route("/api/v1/public/meetings", publicMeetings);
// AI Connector (MCP): own auth (OAuth + hbmcp_ tokens); discovery at the root.
app.route("/api/mcp", mcp);
app.route("/.well-known", mcpWellKnown);
app.route("/api/v1/ai-connector", mcpAdmin);
// Round 4d: morning brief + alerts (per person, opt-in) and the group monthly report (admin).
app.route("/api/v1/ai-brief", proactive);
app.route("/api/v1/group-report", groupReport);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// The AI Connector re-enters the assembled app in-process for its reads.
setMcpApp(app as unknown as Parameters<typeof setMcpApp>[0]);

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
  // health checks and their alert emails run each time; the ticket auto-close and the Anthropic cost read once a
  // day at 02:00 UTC (10:00 GMT+8).
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const db = getDb(env);
    ctx.waitUntil(
      runHealthChecks(db)
        .then(() => sendHealthAlerts(env, db))
        .catch((e) => console.error("[health]", e)),
    );
    // Meeting reminders that are due; each ERP's Mail Center collects and sends them.
    ctx.waitUntil(
      sendDueReminders(env, getDb(env))
        .catch((e) => console.error("[meeting-mail]", e)),
    );
    // Start each ERP's Mail Sync workflow; GitHub's own schedule for it runs hours late (services/mailSyncKick.ts).
    ctx.waitUntil(
      kickMailSyncs({ GH_DISPATCH_TOKEN_HOUZS_CENTURY: env.GH_DISPATCH_TOKEN_HOUZS_CENTURY, GH_DISPATCH_TOKEN_HOUZS_IT: env.GH_DISPATCH_TOKEN_HOUZS_IT }, MAIL_SYNC_TARGETS, fetch)
        .then((rs) => rs.filter((r) => r.status !== 204 && r.status !== "no-token").forEach((r) => console.error("[mail-sync-kick]", r)))
        .catch((e) => console.error("[mail-sync-kick]", e)),
    );
    const at = new Date(event.scheduledTime);
    // AI Connector round 4d, twice an hour (the :00 and :30 runs): the morning briefs and urgent
    // alerts, then the group monthly report (only does anything on the 1st from 09:00 Malaysia time).
    // In-process calls into the app with this isolate's inner secret, so they run as routes
    // (routes/proactive.ts, routes/groupReport.ts) and nobody outside can fire them.
    if (at.getUTCMinutes() % 30 < 5) {
      const origin = (env.HUB_ORIGIN || "https://support.houzscentury.com").replace(/\/+$/, "");
      const tick = (path: string) =>
        Promise.resolve(app.fetch(new Request(`${origin}${path}`, { method: "POST", headers: { [MCP_INNER_HEADER]: mcpInnerSecret() } }), env, ctx))
          .then(async (r) => {
            if (!r.ok) console.error(`[tick ${path}]`, r.status, (await r.text()).slice(0, 200));
          })
          .catch((e) => console.error(`[tick ${path}]`, e));
      ctx.waitUntil(tick("/api/v1/ai-brief/tick").then(() => tick("/api/v1/group-report/tick")));
    }
    if (at.getUTCHours() === 2 && at.getUTCMinutes() < 5) {
      ctx.waitUntil(autoCloseResolved(env));
      // No admin key yet is normal until it is set up; anything else is worth a log line.
      ctx.waitUntil(syncAnthropicCosts(env, getDb(env)).catch((e) => e instanceof UsageSetupError || console.error("[anthropic-usage]", e)));
    }
  },
} satisfies ExportedHandler<Env>;
