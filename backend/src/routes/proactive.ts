// ---------------------------------------------------------------------------
// /api/v1/ai-brief — AI Connector round 4d: the morning brief email (D1), urgent alerts
// (D2) and the Monday data gaps (D4). Pure logic: services/proactive.ts.
//
//   POST /tick             the cron's in-process call (index.ts scheduled, twice an hour);
//                          only with this isolate's MCP inner secret, so nobody outside can fire it.
//   GET|POST /unsubscribe  the link in every email: GET shows ONE button, POST unsubscribes,
//                          so a mail scanner that pre-opens links unsubscribes nobody. No session.
//   GET  /me               the person's own settings (session), PUT /me saves them,
//   GET  /me/preview       the brief as it would be sent now, built as you, NOT sent,
//   POST /me/test          a test brief to your own email only, at most once per 10 minutes.
//
// AS THE PERSON, ALWAYS. Each person gets a short-lived connector token of their own
// (client mcpc_morning_brief), revoked in `finally`; the brief is the daily_brief tool and
// the alerts are tickets_overdue / health_summary, run through routes/mcp.ts runToolAs —
// the same inner GETs, route permission checks and visibility rule as a question from
// Claude. There is no service account.
//
// BOUNDED + IDEMPOTENT. At most maxBriefsPerTick briefs and maxPeoplePerTick alert checks
// per tick, a 20 s budget, people one at a time. One brief per person per Malaysia day
// (key "brief" claimed before building); every alert key at most once per person per day
// (claimed before sending). Each email is logged in mcp_proactive_sends, never its body.
// Without RESEND_API_KEY the tick does nothing and the page says email is not set up.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Context } from "hono";
import { getDb, type DB } from "../db/client";
import { devAuth } from "../middleware/devAuth";
import type { DevApp } from "../types";
import { mcpDbOf } from "../services/mcp-db";
import { isMcpInner, MCP_INNER_HEADER } from "../services/mcp-inner";
import { hasMcpAccess, issueTokens, revokeToken } from "../services/mcp-store";
import { mailConfigured, sendMail } from "../services/mailer";
import {
  alertsToSend,
  buildAlertEmail,
  buildBriefEmail,
  computeAlerts,
  DEFAULT_SUBSCRIPTION,
  escapeHtml,
  isMonday,
  mytNow,
  parseSubscriptionInput,
  pickTickWork,
  plusDays,
  thresholdsForDisplay,
  TICK_BUDGET_MS,
  type MytNow,
} from "../services/proactive";
import {
  activeSubscribers,
  BRIEF_CLIENT_ID,
  claimKeys,
  ensureBriefClient,
  getSubscription,
  keysSentToday,
  logSend,
  markAlertChecked,
  pruneKeys,
  recentSends,
  releaseKey,
  saveSubscription,
  unsubscribeToken,
  unsubscribeWithToken,
  usersWithKey,
  type Subscriber,
} from "../services/proactive-store";
import { isMcpAdmin, mcpIdentity, runToolAs, type McpCtx, type McpIdentity } from "./mcp";

const app = new Hono<DevApp>();

export const SCHEDULE_WORDS =
  "Checked twice an hour (on the hour and the half hour). Briefs go out on the first check at or after your time; alerts are checked 8:00 to 20:00 Malaysia time.";

const asMcp = (c: Context<DevApp>): McpCtx => c as unknown as McpCtx;

/** Links in emails: the hub's public address (var HUB_ORIGIN), else this request's origin. */
export function hubOrigin(c: Context<DevApp> | McpCtx): string {
  const v = (c.env.HUB_ORIGIN ?? "").replace(/\/+$/, "");
  return /^https:\/\//.test(v) ? v : new URL(c.req.url).origin;
}

type Person = { userId: number; name: string; email: string };

/** Run `fn` as the person with a fresh connector token of their own; always revoked afterwards. null = they no longer may use the connector. */
async function withPersonToken<T>(orm: DB, p: Person, fn: (id: McpIdentity, token: string) => Promise<T>): Promise<T | null> {
  const store = mcpDbOf(orm);
  await ensureBriefClient(store);
  const tok = await issueTokens(store, p.userId, BRIEF_CLIENT_ID);
  try {
    const id = await mcpIdentity(orm, tok.accessToken);
    if (!id) return null;
    return await fn(id, tok.accessToken);
  } finally {
    await revokeToken(store, tok.tokenId, null).catch(() => 0);
  }
}

const settingsUrl = (origin: string) => `${origin}/ai-connector`;
const unsubUrl = (origin: string, t: string) => (t ? `${origin}/api/v1/ai-brief/unsubscribe?t=${encodeURIComponent(t)}` : "");

type Built = { ok: true; subject: string; html: string; text: string; items: number } | { ok: false; message: string };

/** The brief AS THE PERSON: daily_brief (+ data_gaps on Monday or on request). */
async function buildBrief(c: McpCtx, orm: DB, p: Person, id: McpIdentity, token: string, now: MytNow, opts: { withGaps: boolean; test?: boolean }): Promise<Built> {
  const b = await runToolAs(c, orm, id, token, "daily_brief", {}, { log: true });
  if (!b.ok) return { ok: false, message: `daily_brief: ${b.message}` };
  let gaps: unknown = null;
  if (opts.withGaps) {
    const g = await runToolAs(c, orm, id, token, "data_gaps", {}, { log: true });
    gaps = g.ok ? g.value : null; // no access to any list → no gaps section
  }
  const origin = hubOrigin(c);
  const mail = buildBriefEmail({
    brief: b.value,
    gaps,
    name: p.name,
    date: now.day,
    origin,
    settingsUrl: settingsUrl(origin),
    unsubscribeUrl: unsubUrl(origin, await unsubscribeToken(mcpDbOf(orm), p.userId)),
    test: opts.test,
  });
  return { ok: true, ...mail };
}

type PersonResult = { brief?: "sent" | "failed" | "already"; alerts?: number; alertError?: string; noAccess?: boolean };

/** One person on one tick: the brief if due, then the alert check if due. Never throws. */
async function runPerson(c: McpCtx, orm: DB, s: Subscriber, now: MytNow, wantBrief: boolean, wantAlerts: boolean): Promise<PersonResult> {
  const out: PersonResult = {};
  const store = mcpDbOf(orm);
  const person: Person = { userId: s.userId, name: s.name, email: s.email };
  const origin = hubOrigin(c);
  const done = await withPersonToken(orm, person, async (id, token) => {
    if (wantBrief) {
      const claimed = await claimKeys(store, s.userId, ["brief"], now.day);
      if (!claimed.length) out.brief = "already";
      else {
        try {
          const built = await buildBrief(c, orm, person, id, token, now, { withGaps: isMonday(now) });
          if (!built.ok) throw new Error(built.message);
          const r = await sendMail(c.env, { to: s.email, subject: built.subject, html: built.html, text: built.text });
          if (!r.sent) throw new Error(r.reason);
          await logSend(store, { userId: s.userId, kind: "brief", day: now.day, items: built.items, status: "sent", note: isMonday(now) ? "with data gaps" : "" });
          out.brief = "sent";
        } catch (e) {
          // Give the claim back so a later tick today can retry (until the cutoff).
          await releaseKey(store, s.userId, "brief", now.day).catch(() => {});
          await logSend(store, { userId: s.userId, kind: "brief", day: now.day, items: 0, status: "failed", note: e instanceof Error ? e.message : String(e) });
          out.brief = "failed";
        }
      }
    }
    if (wantAlerts) {
      try {
        const health = id.user.perms.includes("health_view");
        const [overdue, hs] = await Promise.all([
          runToolAs(c, orm, id, token, "tickets_overdue", {}, { log: false }),
          health ? runToolAs(c, orm, id, token, "health_summary", {}, { log: false }) : Promise.resolve(null),
        ]);
        const alerts = computeAlerts({ overdue: overdue.ok ? overdue.value : null, health: hs && hs.ok ? hs.value : null, origin });
        const fresh = alertsToSend(alerts, await keysSentToday(store, s.userId, now.day));
        const won = new Set(await claimKeys(store, s.userId, fresh.map((a) => a.key), now.day));
        const send = fresh.filter((a) => won.has(a.key));
        if (send.length) {
          const mail = buildAlertEmail({ alerts: send, name: s.name, date: now.day, settingsUrl: settingsUrl(origin), unsubscribeUrl: unsubUrl(origin, await unsubscribeToken(store, s.userId)) });
          const r = await sendMail(c.env, { to: s.email, ...mail });
          if (!r.sent) {
            for (const a of send) await releaseKey(store, s.userId, a.key, now.day).catch(() => {});
            throw new Error(r.reason);
          }
          await logSend(store, { userId: s.userId, kind: "alert", day: now.day, items: send.length, status: "sent", note: [...new Set(send.map((a) => a.kind))].join(",") });
        }
        out.alerts = send.length;
      } catch (e) {
        out.alertError = (e instanceof Error ? e.message : String(e)).slice(0, 120);
      } finally {
        await markAlertChecked(store, s.userId).catch(() => {});
      }
    }
    return true;
  });
  if (done === null) out.noAccess = true;
  return out;
}

// ── POST /tick (the cron, in-process) ───────────────────────────────────────

app.post("/tick", async (c) => {
  if (!isMcpInner(c.req.header(MCP_INNER_HEADER))) return c.json({ error: "Not found" }, 404);
  if (!mailConfigured(c.env)) return c.json({ ok: true, skipped: "Email is not set up (no RESEND_API_KEY)." });
  const t0 = Date.now();
  const now = mytNow(t0);
  const orm = getDb(c.env);
  const store = mcpDbOf(orm);
  const subs = await activeSubscribers(store);
  const work = pickTickWork(subs, now, await usersWithKey(store, "brief", now.day), t0);
  const byId = new Map<number, { s: Subscriber; brief: boolean; alerts: boolean }>();
  for (const s of work.briefs) byId.set(s.userId, { s, brief: true, alerts: false });
  for (const s of work.alerts) byId.set(s.userId, { s, brief: byId.get(s.userId)?.brief ?? false, alerts: true });
  const counts = { briefsSent: 0, briefsFailed: 0, alertEmails: 0, alertLines: 0, alertErrors: 0, noAccess: 0, peopleDone: 0, peopleDeferred: 0 };
  for (const { s, brief, alerts } of byId.values()) {
    if (Date.now() - t0 > TICK_BUDGET_MS) {
      counts.peopleDeferred += 1;
      continue;
    }
    try {
      const r = await runPerson(asMcp(c), orm, s, now, brief, alerts);
      if (r.brief === "sent") counts.briefsSent += 1;
      if (r.brief === "failed") counts.briefsFailed += 1;
      if (r.alerts) {
        counts.alertEmails += 1;
        counts.alertLines += r.alerts;
      }
      if (r.alertError) counts.alertErrors += 1;
      if (r.noAccess) counts.noAccess += 1;
    } catch (e) {
      console.warn("[proactive] person failed:", e instanceof Error ? e.message : String(e));
      counts.alertErrors += 1;
    }
    counts.peopleDone += 1;
  }
  if (now.minutes < 30) await pruneKeys(store, plusDays(now.day, -7)).catch(() => {});
  return c.json({ ok: true, subscribers: subs.length, ...counts, ms: Date.now() - t0 });
});

// ── /unsubscribe (no session) ───────────────────────────────────────────────

function plainPage(title: string, inner: string, status: 200 | 400 = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#F4F5F7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1F2328">
<main style="max-width:480px;margin:48px auto;padding:24px;background:#fff;border:1px solid #D0D7DE;border-radius:12px">${inner}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

const BAD_LINK = `<h1 style="font-size:20px">This link is not valid</h1><p>Change your email settings on the AI Connector page in Houzs IT Hub.</p>`;

app.get("/unsubscribe", (c) => {
  const t = c.req.query("t") ?? "";
  if (!/^[A-Za-z0-9_-]{32}$/.test(t)) return plainPage("Link not valid", BAD_LINK, 400);
  return plainPage(
    "Unsubscribe",
    `<h1 style="font-size:20px;margin:0 0 8px">Stop IT Hub emails?</h1><p style="color:#57606A">This turns off your morning brief and urgent alerts. You can turn them on again on the AI Connector page.</p>
<form method="post" action="/api/v1/ai-brief/unsubscribe"><input type="hidden" name="t" value="${escapeHtml(t)}"><button type="submit" style="height:44px;padding:0 20px;border:0;border-radius:8px;background:#1F6FEB;color:#fff;font-size:15px;font-weight:600;cursor:pointer">Unsubscribe</button></form>`,
  );
});

app.post("/unsubscribe", async (c) => {
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const t = typeof form.t === "string" ? form.t : "";
  const store = mcpDbOf(getDb(c.env));
  const userId = await unsubscribeWithToken(store, t);
  if (!userId) return plainPage("Link not valid", BAD_LINK, 400);
  await logSend(store, { userId, kind: "brief", day: mytNow().day, items: 0, status: "skipped", note: "unsubscribed by email link" });
  return plainPage("Unsubscribed", `<h1 style="font-size:20px;margin:0 0 8px">You are unsubscribed</h1><p style="color:#57606A">No more morning briefs or alerts. Turn them on again any time on the AI Connector page.</p>`);
});

// ── /me (the person's own settings, session) ────────────────────────────────

const me = new Hono<DevApp>();
me.use("*", devAuth);
me.use("*", async (c, next) => {
  if (c.get("viaMcp")) return c.json({ error: "Not available through the AI connector" }, 403);
  await next();
});

const personOf = (c: Context<DevApp>): Person => {
  const u = c.get("user");
  return { userId: u.id, name: u.name, email: (u.email ?? "").trim() };
};
const allowedFor = (c: Context<DevApp>) => hasMcpAccess(mcpDbOf(c.get("db")), c.get("user").id, isMcpAdmin(c.get("user")));
const NOT_ALLOWED = "AI Connector is not turned on for your account. Ask for access first.";

me.get("/", async (c) => {
  const p = personOf(c);
  const store = mcpDbOf(c.get("db"));
  const allowed = await allowedFor(c);
  const sub = await getSubscription(store, p.userId);
  return c.json({
    allowed,
    email: p.email,
    mailReady: mailConfigured(c.env),
    saved: !!sub,
    subscription: sub ?? { userId: p.userId, ...DEFAULT_SUBSCRIPTION },
    thresholds: thresholdsForDisplay(),
    schedule: SCHEDULE_WORDS,
    recent: allowed ? await recentSends(store, p.userId, 10) : [],
  });
});

me.put("/", async (c) => {
  const p = personOf(c);
  if (!(await allowedFor(c))) return c.json({ error: NOT_ALLOWED }, 403);
  const parsed = parseSubscriptionInput(await c.req.json().catch(() => null), p.userId);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  if ((parsed.value.briefEnabled || parsed.value.alertsEnabled) && !p.email.includes("@")) return c.json({ error: "Your hub account has no email address. Ask an admin to add one first." }, 400);
  await saveSubscription(mcpDbOf(c.get("db")), parsed.value);
  return c.json({ subscription: parsed.value });
});

me.get("/preview", async (c) => {
  const p = personOf(c);
  if (!(await allowedFor(c))) return c.json({ error: NOT_ALLOWED }, 403);
  const now = mytNow();
  const orm = c.get("db");
  const built = await withPersonToken(orm, p, (id, token) => buildBrief(asMcp(c), orm, p, id, token, now, { withGaps: c.req.query("gaps") === "1" || isMonday(now) }));
  if (!built || !built.ok) return c.json({ error: `The brief could not be built: ${built ? built.message : NOT_ALLOWED}` }, 502);
  return c.json({ subject: built.subject, html: built.html, items: built.items });
});

me.post("/test", async (c) => {
  const p = personOf(c);
  if (!(await allowedFor(c))) return c.json({ error: NOT_ALLOWED }, 403);
  if (!mailConfigured(c.env)) return c.json({ error: "Email is not set up on the hub yet (no RESEND_API_KEY), so nothing can be sent." }, 503);
  if (!p.email.includes("@")) return c.json({ error: "Your hub account has no email address." }, 400);
  const store = mcpDbOf(c.get("db"));
  const now = mytNow();
  const bucket = `brief_test:${now.hhmm.slice(0, 4)}`; // HH:M, so one per 10 minutes
  if (!(await claimKeys(store, p.userId, [bucket], now.day)).length) return c.json({ error: "A test brief was sent in the last few minutes. Check your inbox, or try again in 10 minutes." }, 429);
  // Saved once, so the email carries a working unsubscribe link.
  if (!(await getSubscription(store, p.userId))) await saveSubscription(store, { userId: p.userId, ...DEFAULT_SUBSCRIPTION });
  const orm = c.get("db");
  const built = await withPersonToken(orm, p, (id, token) => buildBrief(asMcp(c), orm, p, id, token, now, { withGaps: true, test: true }));
  const fail = async (msg: string) => {
    await releaseKey(store, p.userId, bucket, now.day).catch(() => {});
    await logSend(store, { userId: p.userId, kind: "brief_test", day: now.day, items: 0, status: "failed", note: msg });
    return c.json({ error: msg }, 502);
  };
  if (!built || !built.ok) return fail(`The brief could not be built: ${built ? built.message : NOT_ALLOWED}`);
  // To the signed-in person's own address only: never a typed one.
  const r = await sendMail(c.env, { to: p.email, subject: built.subject, html: built.html, text: built.text });
  if (!r.sent) return fail(r.reason);
  await logSend(store, { userId: p.userId, kind: "brief_test", day: now.day, items: built.items, status: "sent", note: "with data gaps" });
  return c.json({ sentTo: p.email, items: built.items });
});

app.route("/me", me);

export default app;
