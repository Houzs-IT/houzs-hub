// ---------------------------------------------------------------------------
// /api/v1/ai-connector — the AI Connector page (frontend pages/AiConnectorPage.tsx)
// and the "Allow?" screen (frontend pages/AiConnectPage.tsx). Session (devAuth) only.
//
//   staff:  GET /me, POST /me/request, POST /me/revoke
//           GET /consent/:id, POST /consent/:id      (the OAuth "Allow?" step)
//   admin:  GET /admin/overview, POST /admin/requests/:id/:decision,
//           POST /admin/access, DELETE /admin/access/:userId, POST /admin/revoke,
//           POST /admin/leak-check, POST /admin/actions (round 4b AI action switches)
// Admin = holds "Manage users".
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Context } from "hono";
import type { DevApp } from "../types";
import { devAuth, loadUser } from "../middleware/devAuth";
import { mcpDbOf } from "../services/mcp-db";
import { forgetVerified } from "../services/mcp-inner";
import { jsonKeys, leakCheckPaths, SECRET_KEY, SENSITIVE_KEY } from "../services/mcp-access";
import {
  appLabel,
  createCode,
  getAuthRequest,
  getClient,
  hasMcpAccess,
  issueTokens,
  randomToken,
  revokeToken,
  revokeUserTokens,
  takeAuthRequest,
} from "../services/mcp-store";
import { EXPORT_TTL_MS, isMcpAdmin, mcpAppRoutes, readEndpoint } from "./mcp";
import { EXPORT_ROW_CAP, RATE_LIMITS } from "../services/mcp-round3";
import { ACTION_TTL_MS, ACTIONS_PER_DAY, mcpActionStore, setActionSwitch, SWITCH_KEYS, switchKey, WRITE_ACTION_LABELS, WRITE_ACTIONS } from "../services/mcp-write-actions";

type HonoEnv = DevApp;
const app = new Hono<HonoEnv>();
app.use("*", devAuth);
// The connector's own token never manages the connector.
app.use("*", async (c, next) => {
  if (c.get("viaMcp")) return c.json({ error: "Not available through the AI connector" }, 403);
  await next();
});

const num = (r: Record<string, unknown>, k: string): number => Number(r[k] ?? 0);
const s = (r: Record<string, unknown>, k: string): string => (r[k] === null || r[k] === undefined ? "" : String(r[k]));
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

function denyUnlessAdmin(c: Context<HonoEnv>): Response | null {
  return isMcpAdmin(c.get("user")) ? null : c.json({ error: "Only the AI Connector admin can do that." }, 403);
}

const connectorUrl = (c: Context<HonoEnv>): string => `${new URL(c.req.url).origin}/api/mcp`;

// ── staff ───────────────────────────────────────────────────────────────────

app.get("/me", async (c) => {
  const u = c.get("user");
  const db = mcpDbOf(c.get("db"));
  const admin = isMcpAdmin(u);
  const allowed = await hasMcpAccess(db, u.id, admin);
  const pending = await db.prepare("SELECT id, created_at FROM mcp_access_requests WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1").bind(u.id).first<Record<string, unknown>>();
  const apps = await db
    .prepare(
      `SELECT t.id, t.created_at, t.last_used_at, cl.client_name
         FROM mcp_tokens t LEFT JOIN mcp_oauth_clients cl ON cl.client_id = t.client_id
        WHERE t.user_id = ? AND t.revoked_at IS NULL AND t.refresh_expires_at > ? AND t.client_id NOT IN ('mcpc_leak_check', 'mcpc_morning_brief')
        ORDER BY t.created_at DESC`,
    )
    .bind(u.id, new Date().toISOString())
    .all<Record<string, unknown>>();
  return c.json({
    allowed,
    isAdmin: admin,
    pendingRequest: pending ? { id: s(pending, "id"), createdAt: iso(pending.created_at) } : null,
    connectorUrl: connectorUrl(c),
    apps: apps.results.map((r) => ({ tokenId: s(r, "id"), app: appLabel(s(r, "client_name")), connectedAt: iso(r.created_at), lastUsedAt: iso(r.last_used_at) })),
  });
});

app.post("/me/request", async (c) => {
  const u = c.get("user");
  const db = mcpDbOf(c.get("db"));
  if (await hasMcpAccess(db, u.id, isMcpAdmin(u))) return c.json({ ok: true, alreadyAllowed: true });
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const existing = await db.prepare("SELECT id FROM mcp_access_requests WHERE user_id = ? AND status = 'pending'").bind(u.id).first();
  if (existing) return c.json({ ok: true, alreadyRequested: true });
  const id = `mcpr_${randomToken(12)}`;
  await db
    .prepare("INSERT INTO mcp_access_requests (id, user_id, reason, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
    .bind(id, u.id, typeof body.reason === "string" ? body.reason.slice(0, 300) : null, new Date().toISOString())
    .run();
  return c.json({ ok: true, id });
});

app.post("/me/revoke", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { tokenId?: unknown };
  if (typeof body.tokenId !== "string") return c.json({ error: "tokenId required" }, 400);
  const n = await revokeToken(mcpDbOf(c.get("db")), body.tokenId, c.get("user").id);
  forgetVerified(); // this isolate's remembered door checks (routes/mcp.ts) end now, not in 15 s
  return c.json({ ok: true, revoked: n });
});

// ── the OAuth "Allow?" step ─────────────────────────────────────────────────

/** Only a signed-in browser session may approve (never the connector's own token). */
function ordinarySession(c: Context<HonoEnv>): boolean {
  return !c.get("viaMcp");
}

app.get("/consent/:id", async (c) => {
  if (!ordinarySession(c)) return c.json({ error: "Sign in with your own staff account to connect an AI app." }, 403);
  const req = await getAuthRequest(mcpDbOf(c.get("db")), c.req.param("id"));
  if (!req) return c.json({ error: "This connect request has expired. Start again from the AI app." }, 404);
  const cl = await getClient(mcpDbOf(c.get("db")), req.clientId);
  const u = c.get("user");
  return c.json({
    app: appLabel(cl?.clientName ?? ""),
    clientName: cl?.clientName ?? "AI app",
    redirectHost: (() => {
      try {
        return new URL(req.redirectUri).host;
      } catch {
        return "";
      }
    })(),
    user: { name: u.name, email: u.email },
    allowed: await hasMcpAccess(mcpDbOf(c.get("db")), u.id, isMcpAdmin(u)),
  });
});

app.post("/consent/:id", async (c) => {
  if (!ordinarySession(c)) return c.json({ error: "Sign in with your own staff account to connect an AI app." }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { decision?: unknown };
  const u = c.get("user");
  const allow = body.decision === "allow";
  if (allow && !(await hasMcpAccess(mcpDbOf(c.get("db")), u.id, isMcpAdmin(u)))) return c.json({ error: "AI Connector is not turned on for your account yet." }, 403);
  const req = await takeAuthRequest(mcpDbOf(c.get("db")), c.req.param("id"));
  if (!req) return c.json({ error: "This connect request has expired. Start again from the AI app." }, 404);
  const back = new URL(req.redirectUri);
  if (req.state) back.searchParams.set("state", req.state);
  if (!allow) {
    back.searchParams.set("error", "access_denied");
    return c.json({ redirect: back.toString() });
  }
  const code = await createCode(mcpDbOf(c.get("db")), { clientId: req.clientId, userId: u.id, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge });
  back.searchParams.set("code", code);
  const cl = await getClient(mcpDbOf(c.get("db")), req.clientId);
  return c.json({ redirect: back.toString() });
});

// ── admin ───────────────────────────────────────────────────────────────────

app.get("/admin/overview", async (c) => {
  const denied = denyUnlessAdmin(c);
  if (denied) return denied;
  const db = mcpDbOf(c.get("db"));
  const nowIso = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [requests, connected, allowed, calls, staff, stats] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.user_id, r.reason, r.created_at, u.name, u.email, (SELECT string_agg(r.name, ', ' ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.key = ur.role_key WHERE ur.user_id = u.id) AS position_name
           FROM mcp_access_requests r JOIN users u ON u.id = r.user_id 
          WHERE r.status = 'pending' ORDER BY r.created_at`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT t.id, t.user_id, t.created_at, t.last_used_at, cl.client_name, u.name, (SELECT string_agg(r.name, ', ' ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.key = ur.role_key WHERE ur.user_id = u.id) AS position_name
           FROM mcp_tokens t JOIN users u ON u.id = t.user_id
           LEFT JOIN mcp_oauth_clients cl ON cl.client_id = t.client_id
           
          WHERE t.revoked_at IS NULL AND t.refresh_expires_at > ? AND t.client_id NOT IN ('mcpc_leak_check', 'mcpc_morning_brief')
          ORDER BY t.last_used_at DESC NULLS LAST, t.created_at DESC`,
      )
      .bind(nowIso)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT a.user_id, a.approved_at, u.name, (SELECT string_agg(r.name, ', ' ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.key = ur.role_key WHERE ur.user_id = u.id) AS position_name
           FROM mcp_access a JOIN users u ON u.id = a.user_id 
          ORDER BY u.name`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT k.id, k.user_id, k.tool, k.target, k.status, k.ok, k.note, k.ms, k.created_at, u.name, cl.client_name
           FROM mcp_calls k JOIN users u ON u.id = k.user_id LEFT JOIN mcp_oauth_clients cl ON cl.client_id = k.client_id
          ORDER BY k.created_at DESC LIMIT 100`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT u.id, u.name, (SELECT string_agg(r.name, ', ' ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.key = ur.role_key WHERE ur.user_id = u.id) AS position_name FROM users u 
          WHERE u.active = 1 AND u.id NOT IN (SELECT user_id FROM mcp_access) ORDER BY u.name`,
      )
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM mcp_calls WHERE created_at > ?) AS calls_24h,
                (SELECT COUNT(*) FROM mcp_calls WHERE created_at > ? AND ok = 0) AS refused_24h,
                (SELECT COUNT(DISTINCT user_id) FROM mcp_tokens WHERE revoked_at IS NULL AND refresh_expires_at > ? AND client_id NOT IN ('mcpc_leak_check', 'mcpc_morning_brief')) AS people`,
      )
      .bind(dayAgo, dayAgo, nowIso)
      .first<Record<string, unknown>>(),
  ]);
  const pos = (r: Record<string, unknown>) => s(r, "position_name") || "—";
  return c.json({
    connectorUrl: connectorUrl(c),
    stats: { connectedPeople: num(stats ?? {}, "people"), callsToday: num(stats ?? {}, "calls_24h"), refusedToday: num(stats ?? {}, "refused_24h"), waiting: requests.results.length },
    limits: { ...RATE_LIMITS, exportRows: EXPORT_ROW_CAP, exportLinkMinutes: EXPORT_TTL_MS / 60_000 },
    requests: requests.results.map((r) => ({ id: s(r, "id"), userId: num(r, "user_id"), name: s(r, "name"), position: pos(r), reason: s(r, "reason"), createdAt: iso(r.created_at) })),
    connected: connected.results.map((r) => ({ tokenId: s(r, "id"), userId: num(r, "user_id"), name: s(r, "name"), position: pos(r), app: appLabel(s(r, "client_name")), connectedAt: iso(r.created_at), lastUsedAt: iso(r.last_used_at) })),
    allowed: allowed.results.map((r) => ({ userId: num(r, "user_id"), name: s(r, "name"), position: pos(r), approvedAt: iso(r.approved_at) })),
    calls: calls.results.map((r) => ({ id: s(r, "id"), userId: num(r, "user_id"), name: s(r, "name"), app: appLabel(s(r, "client_name")), tool: s(r, "tool"), target: s(r, "target"), status: num(r, "status"), ok: num(r, "ok") === 1, note: s(r, "note"), ms: num(r, "ms"), at: iso(r.created_at) })),
    staff: staff.results.map((r) => ({ userId: num(r, "id"), name: s(r, "name"), position: pos(r) })),
    actions: await actionsState(db),
  });
});

// ── round 4b: AI action switches (admin only, default OFF) ──────────────────

async function actionsState(db: ReturnType<typeof mcpDbOf>) {
  const sw = await mcpActionStore(db).switches();
  return {
    enabled: sw.main,
    perDay: ACTIONS_PER_DAY,
    confirmMinutes: ACTION_TTL_MS / 60_000,
    list: WRITE_ACTIONS.map((a) => ({ key: switchKey(a), label: WRITE_ACTION_LABELS[a], enabled: sw[a] })),
  };
}

app.post("/admin/actions", async (c) => {
  const denied = denyUnlessAdmin(c);
  if (denied) return denied;
  const body = (await c.req.json().catch(() => ({}))) as { key?: unknown; enabled?: unknown };
  const key = typeof body.key === "string" ? body.key : "";
  if (!SWITCH_KEYS.includes(key) || typeof body.enabled !== "boolean") return c.json({ error: `key must be one of ${SWITCH_KEYS.join(", ")} and enabled true or false` }, 400);
  const db = mcpDbOf(c.get("db"));
  await setActionSwitch(db, key, body.enabled, c.get("user").id);
  return c.json({ ok: true, actions: await actionsState(db) });
});

async function grant(c: Context<HonoEnv>, userId: number): Promise<void> {
  await mcpDbOf(c.get("db"))
    .prepare("INSERT INTO mcp_access (user_id, approved_by, approved_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING")
    .bind(userId, c.get("user").id, new Date().toISOString())
    .run();
}

app.post("/admin/requests/:id/:decision", async (c) => {
  const denied = denyUnlessAdmin(c);
  if (denied) return denied;
  const decision = c.req.param("decision");
  if (decision !== "approve" && decision !== "reject") return c.json({ error: "decision must be approve or reject" }, 400);
  const db = mcpDbOf(c.get("db"));
  const r = await db
    .prepare("UPDATE mcp_access_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending' RETURNING user_id")
    .bind(decision === "approve" ? "approved" : "rejected", c.get("user").id, new Date().toISOString(), c.req.param("id"))
    .first<Record<string, unknown>>();
  if (!r) return c.json({ error: "Request not found or already decided." }, 404);
  const userId = num(r, "user_id");
  if (decision === "approve") await grant(c, userId);
  return c.json({ ok: true });
});

app.post("/admin/access", async (c) => {
  const denied = denyUnlessAdmin(c);
  if (denied) return denied;
  const body = (await c.req.json().catch(() => ({}))) as { userId?: unknown };
  const userId = Number(body.userId);
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: "userId required" }, 400);
  const u = await loadUser(c.get("db"), userId);
  if (!u || !u.active) return c.json({ error: "User not found or inactive." }, 404);
  await grant(c, userId);
  await mcpDbOf(c.get("db")).prepare("UPDATE mcp_access_requests SET status = 'approved', decided_by = ?, decided_at = ? WHERE user_id = ? AND status = 'pending'").bind(c.get("user").id, new Date().toISOString(), userId).run();
  return c.json({ ok: true });
});

app.delete("/admin/access/:userId", async (c) => {
  const denied = denyUnlessAdmin(c);
  if (denied) return denied;
  const userId = Number(c.req.param("userId"));
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: "userId required" }, 400);
  const db = mcpDbOf(c.get("db"));
  await db.prepare("DELETE FROM mcp_access WHERE user_id = ?").bind(userId).run();
  const revoked = await revokeUserTokens(db, userId);
  forgetVerified();
  return c.json({ ok: true, revoked });
});

app.post("/admin/revoke", async (c) => {
  const denied = denyUnlessAdmin(c);
  if (denied) return denied;
  const body = (await c.req.json().catch(() => ({}))) as { tokenId?: unknown; userId?: unknown };
  let n = 0;
  if (typeof body.tokenId === "string") n = await revokeToken(mcpDbOf(c.get("db")), body.tokenId, null);
  else if (Number.isInteger(Number(body.userId)) && Number(body.userId) > 0) n = await revokeUserTokens(mcpDbOf(c.get("db")), Number(body.userId));
  else return c.json({ error: "tokenId or userId required" }, 400);
  forgetVerified();
  return c.json({ ok: true, revoked: n });
});

// ── leak check ──────────────────────────────────────────────────────────────
// Runs the connector's real read path AS the chosen staff account over every
// parameter-free list endpoint, a page at a time (the page loops `offset`
// until `done`). Field NAMES and outcomes only, never values.

export type LeakRow = { path: string; outcome: "opened" | "refused" | "error"; status: number; hidden: string[]; sensitive: string[] };
const LEAK_CLIENT_ID = "mcpc_leak_check";
const LEAK_PAGE = 20;
const LEAK_PARALLEL = 4;

export function analyseBody(path: string, status: number, isError: boolean, body: unknown, removed: string[]): LeakRow {
  if (status === 401 || status === 403) return { path, outcome: "refused", status, hidden: [], sensitive: [] };
  if (isError) return { path, outcome: "error", status, hidden: [], sensitive: [] };
  const keys = [...jsonKeys(body)];
  return { path, outcome: "opened", status, hidden: removed, sensitive: keys.filter((k) => SENSITIVE_KEY.test(k) && !SECRET_KEY.test(k)).sort() };
}

app.post("/admin/leak-check", async (c) => {
  const denied = denyUnlessAdmin(c);
  if (denied) return denied;
  const db = mcpDbOf(c.get("db"));
  const body = (await c.req.json().catch(() => ({}))) as { userId?: unknown; offset?: unknown };
  const userId = Number(body.userId);
  const offset = Math.max(0, Number(body.offset) || 0);
  const u = Number.isInteger(userId) && userId > 0 ? await loadUser(c.get("db"), userId) : null;
  if (!u) return c.json({ error: "User not found" }, 404);
  if (isMcpAdmin(u)) return c.json({ error: "Admins see everything — pick a staff account." }, 400);
  if (!u.active) return c.json({ error: "That account is inactive." }, 400);
  if (!(await hasMcpAccess(db, userId, false))) return c.json({ error: "Turn on AI Connector for this account first (it needs access to be checked)." }, 400);

  await db
    .prepare("INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, 'Leak check', '[]', ?) ON CONFLICT (client_id) DO NOTHING")
    .bind(LEAK_CLIENT_ID, new Date().toISOString())
    .run();
  const paths = leakCheckPaths(mcpAppRoutes());
  const page = paths.slice(offset, offset + LEAK_PAGE);
  const tok = await issueTokens(db, userId, LEAK_CLIENT_ID);
  const rows: LeakRow[] = [];
  try {
    for (let i = 0; i < page.length; i += LEAK_PARALLEL) {
      const chunk = page.slice(i, i + LEAK_PARALLEL);
      // eslint-disable-next-line no-await-in-loop -- bounded fan-out: 4 in-process reads at a time, so one check never floods the DB pool
      const got = await Promise.all(
        chunk.map(async (path) => {
          try {
            const r = await readEndpoint(c as unknown as Parameters<typeof readEndpoint>[0], tok.accessToken, path, { limit: 5, page: 1 });
            return analyseBody(path, r.status, !!r.result.isError, r.body, r.removed);
          } catch {
            return { path, outcome: "error" as const, status: 500, hidden: [], sensitive: [] };
          }
        }),
      );
      rows.push(...got);
    }
  } finally {
    await revokeToken(db, tok.tokenId, null);
  }
  return c.json({ person: u.name, position: u.roleName, total: paths.length, offset, next: offset + page.length, done: offset + page.length >= paths.length, rows });
});

export default app;
