// ---------------------------------------------------------------------------
// /api/v1/group-report — the group monthly report (AI Connector round 4d D3, owner 2026-11-26).
//
// The hub is an MCP CLIENT of each system's own AI connector (Hookka, Houzs, The Conts,
// HRIS). The admin connects each system ONCE through that system's normal OAuth (dynamic
// client registration + PKCE + its own "Allow?" screen), so every figure comes through HIS
// grant and HIS permissions there. The hub never reads another system's database.
//
//   GET    /                 status: configured?, each system connected or not, past reports.
//   POST   /connect/:system  starts the OAuth flow; answers {url} for the browser to open.
//   GET    /callback         the system sends the browser back here; tokens stored sealed.
//   POST   /disconnect/:system
//   POST   /build {month}    builds the report now (not emailed) and keeps a copy.
//   GET    /reports/:id      a past report's HTML (from R2), sandboxed.
//   POST   /tick             the cron's in-process call: on the 1st from 09:00 Malaysia time,
//                            last month's report, emailed to the admin(s) who connected.
//
// Admin only: the hub's top permission, "Manage roles". Tokens are AES-GCM sealed with the
// GROUP_REPORT_KEY secret (services/group-crypto.ts); without it the page says "not
// configured". Tokens are never logged or returned.
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Context } from "hono";
import { getDb } from "../db/client";
import { devAuth } from "../middleware/devAuth";
import type { DevApp, Env } from "../types";
import { mcpDbOf, type McpDb } from "../services/mcp-db";
import { isMcpInner, MCP_INNER_HEADER } from "../services/mcp-inner";
import { sha256Hex } from "../services/mcp-store";
import { mailConfigured, sendMail } from "../services/mailer";
import { keyConfigured, seal, unseal } from "../services/group-crypto";
import { authorizeUrl, callTool, discover, exchangeCode, McpClientError, pkcePair, randomString, refreshAccess, registerClient } from "../services/mcp-client";
import {
  answerOf,
  buildGroupReport,
  GROUP_SYSTEMS,
  monthLabel,
  monthlyDue,
  renderReportHtml,
  renderReportText,
  systemByKey,
  validReportMonth,
  type GroupReport,
  type GroupSystem,
  type Outcome,
} from "../services/group-report";
import { hubOrigin } from "./proactive";

/** Who may use the group report: the hub's top admin permission. */
export const GROUP_REPORT_PERMISSION = "roles";
const PENDING_TTL_MS = 10 * 60_000;
const R2_PREFIX = "group-reports/";

type Row = Record<string, unknown>;
const s = (r: Row | null | undefined, k: string) => (r && r[k] !== null && r[k] !== undefined ? (r[k] instanceof Date ? (r[k] as Date).toISOString() : String(r[k])) : "");

const app = new Hono<DevApp>();

// ── tokens ──────────────────────────────────────────────────────────────────

type Conn = { system: string; userId: number; mcpUrl: string; clientId: string; tokenEndpoint: string; accessEnc: string; accessExpiresAt: string; refreshEnc: string };

async function connections(db: McpDb): Promise<Conn[]> {
  const r = await db.prepare("SELECT * FROM group_report_connections").all<Row>();
  return r.results.map((x) => ({
    system: s(x, "system"),
    userId: Number(x.user_id),
    mcpUrl: s(x, "mcp_url"),
    clientId: s(x, "client_id"),
    tokenEndpoint: s(x, "token_endpoint"),
    accessEnc: s(x, "access_enc"),
    accessExpiresAt: s(x, "access_expires_at"),
    refreshEnc: s(x, "refresh_enc"),
  }));
}

async function noteError(db: McpDb, system: string, msg: string | null) {
  await db.prepare("UPDATE group_report_connections SET last_error = ?, last_used_at = ? WHERE system = ?").bind(msg ? msg.slice(0, 300) : null, new Date().toISOString(), system).run();
}

/** A usable access token: the stored one while it has a minute left, else refreshed (and both stored again). */
async function accessToken(env: Env, db: McpDb, c: Conn, force = false): Promise<string> {
  const key = env.GROUP_REPORT_KEY!;
  if (!force && c.accessEnc && Date.parse(c.accessExpiresAt) > Date.now() + 60_000) return unseal(key, c.accessEnc, `${c.system}:access`);
  if (!c.refreshEnc) throw new McpClientError("The sign-in has expired: connect this system again.", "invalid_grant");
  const t = await refreshAccess({ tokenEndpoint: c.tokenEndpoint, refreshToken: await unseal(key, c.refreshEnc, `${c.system}:refresh`), clientId: c.clientId, resource: c.mcpUrl }, fetch);
  const accessEnc = await seal(key, t.accessToken, `${c.system}:access`);
  const refreshEnc = t.refreshToken ? await seal(key, t.refreshToken, `${c.system}:refresh`) : c.refreshEnc;
  await db.prepare("UPDATE group_report_connections SET access_enc = ?, access_expires_at = ?, refresh_enc = ? WHERE system = ?").bind(accessEnc, t.expiresAt, refreshEnc, c.system).run();
  Object.assign(c, { accessEnc, accessExpiresAt: t.expiresAt, refreshEnc });
  return t.accessToken;
}

/** Every company_report call of one system, as the admin who connected it. */
async function askSystem(env: Env, db: McpDb, sys: GroupSystem, conn: Conn, month: string): Promise<Record<string, Outcome>> {
  const out: Record<string, Outcome> = {};
  try {
    let token = await accessToken(env, db, conn);
    for (const call of sys.calls) {
      try {
        let r;
        try {
          r = await callTool(sys.mcpUrl, token, "company_report", call.args(month), fetch);
        } catch (e) {
          if (!(e instanceof McpClientError) || e.code !== "unauthorized") throw e;
          token = await accessToken(env, db, conn, true); // one refresh, one retry
          r = await callTool(sys.mcpUrl, token, "company_report", call.args(month), fetch);
        }
        out[call.company] = answerOf(r);
      } catch (e) {
        if (e instanceof McpClientError && (e.code === "invalid_grant" || e.code === "unauthorized")) throw e;
        out[call.company] = { status: "error", message: e instanceof Error ? e.message : String(e) };
      }
    }
    await noteError(db, sys.key, null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await noteError(db, sys.key, msg).catch(() => {});
    for (const call of sys.calls) out[call.company] ??= { status: "error", message: msg };
  }
  return out;
}

async function buildReport(env: Env, db: McpDb, month: string): Promise<GroupReport> {
  const conns = await connections(db);
  const outcomes: Record<string, Record<string, Outcome>> = {};
  await Promise.all(
    GROUP_SYSTEMS.map(async (sys) => {
      const conn = conns.find((x) => x.system === sys.key);
      if (conn) outcomes[sys.key] = await askSystem(env, db, sys, conn, month);
    }),
  );
  return buildGroupReport(month, outcomes, new Date().toISOString());
}

async function storeReport(env: Env, db: McpDb, id: number, r: GroupReport, origin: string): Promise<string> {
  const html = renderReportHtml(r, { hubUrl: origin });
  await env.FILES.put(`${R2_PREFIX}${id}.html`, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  await db.prepare("UPDATE group_reports SET status_json = ?, note = NULL WHERE id = ?").bind(JSON.stringify(r.systems), id).run();
  return html;
}

// ── POST /tick (the cron, in-process) ───────────────────────────────────────

app.post("/tick", async (c) => {
  if (!isMcpInner(c.req.header(MCP_INNER_HEADER))) return c.json({ error: "Not found" }, 404);
  const month = monthlyDue();
  if (!month) return c.json({ ok: true, skipped: "not the 1st after 09:00 Malaysia time" });
  if (!keyConfigured(c.env.GROUP_REPORT_KEY)) return c.json({ ok: true, skipped: "GROUP_REPORT_KEY is not configured" });
  const db = mcpDbOf(getDb(c.env));
  const conns = await connections(db);
  if (!conns.length) return c.json({ ok: true, skipped: "no system connected" });
  // The claim: one scheduled report per month (unique index), so ticks never build it twice.
  const claim = await db.prepare("INSERT INTO group_reports (month, kind, note) VALUES (?, 'scheduled', 'building') ON CONFLICT DO NOTHING RETURNING id").bind(month).first<Row>();
  if (!claim) return c.json({ ok: true, skipped: "already built" });
  const id = Number(claim.id);
  try {
    const r = await buildReport(c.env, db, month);
    const origin = hubOrigin(c);
    const html = await storeReport(c.env, db, id, r, origin);
    if (!mailConfigured(c.env)) {
      await db.prepare("UPDATE group_reports SET note = ? WHERE id = ?").bind("Not emailed: email is not set up (no RESEND_API_KEY).", id).run();
      return c.json({ ok: true, id, emailed: 0 });
    }
    const owners = await db
      .prepare("SELECT DISTINCT u.email FROM group_report_connections g JOIN users u ON u.id = g.user_id WHERE u.active = 1 AND u.email IS NOT NULL AND u.email <> ''")
      .all<Row>();
    const sent: string[] = [];
    for (const o of owners.results) {
      const to = s(o, "email").trim();
      const m = await sendMail(c.env, { to, subject: `Group report: ${monthLabel(month)}`, html, text: renderReportText(r, { hubUrl: origin }) });
      if (m.sent) sent.push(to);
      else console.warn("[group-report] email not sent:", m.reason);
    }
    await db.prepare("UPDATE group_reports SET emailed_to = ?, emailed_at = ? WHERE id = ?").bind(sent.join(", ") || null, sent.length ? new Date().toISOString() : null, id).run();
    return c.json({ ok: true, id, emailed: sent.length });
  } catch (e) {
    // Give the month back so a later tick today tries again.
    await db.prepare("DELETE FROM group_reports WHERE id = ?").bind(id).run().catch(() => {});
    console.error("[group-report]", e instanceof Error ? e.message : String(e));
    return c.json({ ok: false, error: "build failed" }, 500);
  }
});

// ── session routes (admin only) ─────────────────────────────────────────────

const admin = new Hono<DevApp>();
admin.use("*", devAuth);
admin.use("*", async (c, next) => {
  if (c.get("viaMcp")) return c.json({ error: "Not available through the AI connector" }, 403);
  if (!c.get("user").perms.includes(GROUP_REPORT_PERMISSION)) return c.json({ error: "Only an admin with Manage roles can use the group report." }, 403);
  await next();
});

const storeOf = (c: Context<DevApp>) => mcpDbOf(c.get("db"));
const redirectUri = (c: Context<DevApp>) => `${hubOrigin(c)}/api/v1/group-report/callback`;
const NOT_CONFIGURED = "The group report is not configured: the GROUP_REPORT_KEY secret is not set on the hub.";

admin.get("/", async (c) => {
  const db = storeOf(c);
  const [conns, reports] = await Promise.all([
    db.prepare("SELECT g.system, g.connected_at, g.last_used_at, g.last_error, u.name FROM group_report_connections g LEFT JOIN users u ON u.id = g.user_id").all<Row>(),
    db.prepare("SELECT r.id, r.month, r.kind, r.built_at, r.status_json, r.emailed_to, r.emailed_at, r.note, u.name FROM group_reports r LEFT JOIN users u ON u.id = r.built_by ORDER BY r.built_at DESC LIMIT 36").all<Row>(),
  ]);
  return c.json({
    configured: keyConfigured(c.env.GROUP_REPORT_KEY),
    mailReady: mailConfigured(c.env),
    schedule: "On the 1st of each month at 09:00 Malaysia time: last month's report, emailed to the admin who connected the systems.",
    systems: GROUP_SYSTEMS.map((sys) => {
      const r = conns.results.find((x) => s(x, "system") === sys.key);
      return { key: sys.key, name: sys.name, mcpUrl: sys.mcpUrl, companies: sys.calls.map((x) => x.company), connected: !!r, connectedBy: s(r, "name") || null, connectedAt: s(r, "connected_at") || null, lastUsedAt: s(r, "last_used_at") || null, lastError: s(r, "last_error") || null };
    }),
    reports: reports.results.map((r) => {
      let systems: unknown = [];
      try {
        systems = JSON.parse(s(r, "status_json") || "[]");
      } catch {
        systems = [];
      }
      return { id: Number(r.id), month: s(r, "month"), kind: s(r, "kind"), builtAt: s(r, "built_at"), builtBy: s(r, "name") || null, systems, emailedTo: s(r, "emailed_to") || null, emailedAt: s(r, "emailed_at") || null, note: s(r, "note") || null };
    }),
  });
});

admin.post("/connect/:system", async (c) => {
  const sys = systemByKey(c.req.param("system"));
  if (!sys) return c.json({ error: "Unknown system." }, 404);
  const key = c.env.GROUP_REPORT_KEY;
  if (!keyConfigured(key)) return c.json({ error: NOT_CONFIGURED }, 503);
  try {
    const meta = await discover(sys.mcpUrl, fetch);
    const ru = redirectUri(c);
    const clientId = await registerClient(meta, ru, fetch);
    const { verifier, challenge } = await pkcePair();
    const state = randomString(24);
    const db = storeOf(c);
    await db.prepare("DELETE FROM group_report_pending WHERE expires_at < ?").bind(new Date().toISOString()).run();
    await db
      .prepare("INSERT INTO group_report_pending (state_hash, system, user_id, verifier_enc, client_id, token_endpoint, redirect_uri, mcp_url, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(await sha256Hex(state), sys.key, c.get("user").id, await seal(key, verifier, `pending:${sys.key}`), clientId, meta.tokenEndpoint, ru, meta.resource, new Date(Date.now() + PENDING_TTL_MS).toISOString())
      .run();
    return c.json({ url: authorizeUrl({ meta, clientId, redirectUri: ru, state, challenge }) });
  } catch (e) {
    return c.json({ error: `Could not start the connection to ${sys.name}: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
});

admin.get("/callback", async (c) => {
  const back = (q: string) => c.redirect(`/group-report?${q}`, 302);
  const state = c.req.query("state") ?? "";
  const key = c.env.GROUP_REPORT_KEY;
  if (!keyConfigured(key)) return back("error=not_configured");
  if (!state) return back("error=missing_state");
  const db = storeOf(c);
  const p = await db
    .prepare("DELETE FROM group_report_pending WHERE state_hash = ? AND user_id = ? AND expires_at > ? RETURNING *")
    .bind(await sha256Hex(state), c.get("user").id, new Date().toISOString())
    .first<Row>();
  if (!p) return back("error=expired");
  const system = s(p, "system");
  if (c.req.query("error")) return back(`error=denied&system=${encodeURIComponent(system)}`);
  const code = c.req.query("code") ?? "";
  if (!code) return back(`error=no_code&system=${encodeURIComponent(system)}`);
  try {
    const t = await exchangeCode({ tokenEndpoint: s(p, "token_endpoint"), code, verifier: await unseal(key, s(p, "verifier_enc"), `pending:${system}`), clientId: s(p, "client_id"), redirectUri: s(p, "redirect_uri"), resource: s(p, "mcp_url") }, fetch);
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO group_report_connections (system, user_id, mcp_url, client_id, token_endpoint, access_enc, access_expires_at, refresh_enc, connected_at, last_used_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
         ON CONFLICT (system) DO UPDATE SET user_id = EXCLUDED.user_id, mcp_url = EXCLUDED.mcp_url, client_id = EXCLUDED.client_id, token_endpoint = EXCLUDED.token_endpoint,
           access_enc = EXCLUDED.access_enc, access_expires_at = EXCLUDED.access_expires_at, refresh_enc = EXCLUDED.refresh_enc, connected_at = EXCLUDED.connected_at, last_used_at = NULL, last_error = NULL`,
      )
      .bind(system, c.get("user").id, s(p, "mcp_url"), s(p, "client_id"), s(p, "token_endpoint"), await seal(key, t.accessToken, `${system}:access`), t.expiresAt, t.refreshToken ? await seal(key, t.refreshToken, `${system}:refresh`) : null, now)
      .run();
    return back(`connected=${encodeURIComponent(system)}`);
  } catch (e) {
    console.warn("[group-report] connect failed:", system, e instanceof McpClientError ? e.code : "error");
    return back(`error=token&system=${encodeURIComponent(system)}`);
  }
});

admin.post("/disconnect/:system", async (c) => {
  const sys = systemByKey(c.req.param("system"));
  if (!sys) return c.json({ error: "Unknown system." }, 404);
  await storeOf(c).prepare("DELETE FROM group_report_connections WHERE system = ?").bind(sys.key).run();
  return c.json({ ok: true, note: `Disconnected here. To end the sign-in on ${sys.name} too, disconnect "Houzs IT Hub group report" on its AI Connector page.` });
});

admin.post("/build", async (c) => {
  if (!keyConfigured(c.env.GROUP_REPORT_KEY)) return c.json({ error: NOT_CONFIGURED }, 503);
  const body = (await c.req.json().catch(() => ({}))) as { month?: unknown };
  if (!validReportMonth(body.month)) return c.json({ error: "Pick a month (YYYY-MM), up to this month." }, 400);
  const db = storeOf(c);
  if (!(await connections(db)).length) return c.json({ error: "Connect at least one system first." }, 400);
  const r = await buildReport(c.env, db, body.month);
  const row = await db.prepare("INSERT INTO group_reports (month, kind, built_by) VALUES (?, 'manual', ?) RETURNING id").bind(body.month, c.get("user").id).first<Row>();
  const id = Number(row?.id);
  await storeReport(c.env, db, id, r, hubOrigin(c));
  return c.json({ id, systems: r.systems });
});

admin.get("/reports/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Not found" }, 404);
  const obj = await c.env.FILES.get(`${R2_PREFIX}${id}.html`);
  if (!obj) return c.json({ error: "This report's copy is not available." }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      // Our own HTML, but rendered from other systems' answers: no scripts, no outside loads.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    },
  });
});

app.route("/", admin);

export default app;

