// ---------------------------------------------------------------------------
// /api/mcp — the IT Hub's AI Connector (MCP server). Owner 2026-11-25 「把全部系统的mcp都complete掉」.
// Every handler here does its own auth (index.ts mounts it beside the other routers).
//
//   POST /api/mcp                    MCP Streamable HTTP (JSON-RPC, stateless), Bearer hzmcp_…
//   POST /api/mcp/oauth/register     OAuth dynamic client registration (public clients).
//   GET  /api/mcp/oauth/authorize    → the SPA's /ai-connect "Allow?" screen (routes/mcpAdmin.ts consent).
//   POST /api/mcp/oauth/token        authorization_code (PKCE S256) / refresh_token (rotating).
//   GET  /.well-known/oauth-*        discovery (mounted at the root; wrangler.toml runs the Worker first there).
//
// OWN-PERMISSIONS by construction: a tool call re-enters the whole app as a GET
// carrying the person's MCP token. middleware/devAuth.ts accepts an hbmcp_ token
// ONLY on that in-process call (a per-isolate secret header nobody outside can
// know) and ONLY for GET/HEAD, then runs every route as the real person — their
// roles and permissions.
// Round 4b (owner 2026-11-26) adds three write actions, each propose → the person
// says yes → confirm_action → ONE armed call to the hub's own ticket route
// (services/mcp-write-actions.ts: switches, daily cap, fence). Round 4c: the
// tools/list is filtered per person, prompts per role, structured output, a 60 s
// cache and hub links (services/mcp-visibility.ts).
// ---------------------------------------------------------------------------
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../types";
import { getDb, type DB } from "../db/client";
import { loadUser } from "../middleware/devAuth";
import { mcpDbOf, type McpDb } from "../services/mcp-db";
import type { DevUser } from "../types";
import { borrowDb, lendDb, MCP_INNER_HEADER, mcpInnerSecret, rememberVerified } from "../services/mcp-inner";
import {
  myToday,
  pickFields,
  promptText,
  PROMPTS,
  summariseHealth,
  summariseTickets,
  TICKET_CODE,
  ticketDocument,
  ticketSearchResults,
  ticketWindow,
} from "../services/mcp-quick";
import {
  buildDailyBrief,
  cleanList,
  cleanSystems,
  DAILY_BRIEF_PROMPT,
  DAILY_BRIEF_TEXT,
  dayCount,
  EXPORT_ROW_CAP,
  exportFileName,
  inCreatedRange,
  OVERDUE_DAYS_DEFAULT,
  pickColumns,
  MAX_BATCH,
  RATE_LIMITS,
  rateLimitMessage,
  summariseMeetingsDay,
  summariseMyTickets,
  summariseTicketList,
  summariseTicketsToday,
  TICKET_EXPORT_COLUMNS,
  TICKET_PRIORITY_FILTERS,
  TICKET_STATUS_FILTERS,
  TICKET_TYPE_FILTERS,
  myDayRange,
  type BriefPart,
} from "../services/mcp-round3";
import { periodWindow, PERIODS, ROUND4_TOOLS, runRound4Tool } from "../services/mcp-round4";
import { buildXlsx, XLSX_TYPE } from "../services/xlsx";
import {
  ACTION_PERMISSION,
  ACTION_TOOLS,
  ACTIONS_PER_DAY,
  armConfirmedAction,
  cancelAction,
  confirmAction,
  MCP_ACTION_HEADER,
  mcpActionStore,
  proposeAction,
  TOOL_ACTION,
  WRITE_ACTIONS,
  type ActionDeps,
} from "../services/mcp-write-actions";
import {
  AnswerCache,
  CACHEABLE_TOOLS,
  needLabel,
  PROMPT_TOOLS,
  QUICK_OUTPUT_SCHEMA,
  ROLE_PROMPTS,
  rolePromptText,
  STRUCTURED_TOOLS,
  toolAllowed,
  withHubLinks,
  type Switches,
} from "../services/mcp-visibility";
import { classifyPath, moduleCatalog, readablePaths, redactSecrets, type RouteInfo } from "../services/mcp-access";
import {
  consumeCode,
  countRecentCalls,
  createAuthRequest,
  getClient,
  hasMcpAccess,
  issueTokens,
  logCall,
  MCP_ADMIN_PERMISSION,
  pkceS256,
  refreshTokens,
  randomToken,
  registerClient,
  resolveAccessToken,
  sha256Hex,
  validRedirectUri,
} from "../services/mcp-store";

type HonoEnv = { Bindings: Env };
const app = new Hono<HonoEnv>();

// The whole app, for in-process tool calls; set by index.ts (importing it here would be circular).
type FetchApp = { fetch: (req: Request, env: Env, ctx?: unknown) => Response | Promise<Response>; routes: RouteInfo[] };
let appRef: FetchApp | null = null;
export function setMcpApp(a: FetchApp): void {
  appRef = a;
}
export function mcpAppRoutes(): RouteInfo[] {
  return appRef?.routes ?? [];
}

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const MAX_RESULT_CHARS = 30_000;
const SERVER_INFO = { name: "houzs-it-hub", title: "Houzs IT Hub", version: "1.0.0" };

const originOf = (c: Context<HonoEnv>): string => new URL(c.req.url).origin;

export const isMcpAdmin = (u: DevUser): boolean => u.perms.includes(MCP_ADMIN_PERMISSION);

// ── discovery ───────────────────────────────────────────────────────────────

export function protectedResourceMetadata(origin: string) {
  return { resource: `${origin}/api/mcp`, authorization_servers: [origin], bearer_methods_supported: ["header"], scopes_supported: ["erp.read"], resource_name: "Houzs IT Hub" };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["erp.read"],
  };
}

export const mcpWellKnown = new Hono<HonoEnv>();
mcpWellKnown.get("/oauth-protected-resource", (c) => c.json(protectedResourceMetadata(originOf(c))));
mcpWellKnown.get("/oauth-protected-resource/*", (c) => c.json(protectedResourceMetadata(originOf(c))));
mcpWellKnown.get("/oauth-authorization-server", (c) => c.json(authorizationServerMetadata(originOf(c))));
mcpWellKnown.get("/oauth-authorization-server/*", (c) => c.json(authorizationServerMetadata(originOf(c))));

// ── OAuth ───────────────────────────────────────────────────────────────────

app.post("/oauth/register", async (c) => {
  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_client_metadata", error_description: "JSON body required" }, 400);
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (uris.length === 0 || uris.length > 5 || uris.some((u) => u.length > 500 || !validRedirectUri(u))) {
    return c.json({ error: "invalid_redirect_uri", error_description: "1-5 https redirect URIs required" }, 400);
  }
  const cl = await registerClient(mcpDbOf(getDb(c.env)), typeof body.client_name === "string" ? body.client_name : "AI app", uris);
  return c.json(
    {
      client_id: cl.clientId,
      client_name: cl.clientName,
      redirect_uris: cl.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    201,
  );
});

const plain = (msg: string, status: 400 | 403 = 400) =>
  new Response(`${msg}\n`, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

app.get("/oauth/authorize", async (c) => {
  const q = (k: string) => c.req.query(k) ?? "";
  const clientId = q("client_id");
  const redirectUri = q("redirect_uri");
  if (!clientId || !redirectUri) return plain("Invalid request: missing client or redirect address.");
  const store = mcpDbOf(getDb(c.env));
  const cl = await getClient(store, clientId);
  if (!cl) return plain("This AI app is not registered. Remove the connector and add it again.");
  if (!cl.redirectUris.includes(redirectUri)) return plain("Invalid request: the return address does not match this app.");
  if (q("response_type") !== "code") return plain("Only response_type=code is supported.");
  if (!q("code_challenge") || q("code_challenge_method") !== "S256") return plain("This app must use PKCE (S256).");
  const id = await createAuthRequest(store, { clientId, redirectUri, state: q("state"), codeChallenge: q("code_challenge") });
  // The SPA signs the person in (or uses their session) and shows Allow / Cancel.
  return c.redirect(`${originOf(c)}/ai-connect?request=${encodeURIComponent(id)}`, 302);
});

app.post("/oauth/token", async (c) => {
  const ct = c.req.header("content-type") ?? "";
  let f: Record<string, string | undefined> = {};
  try {
    const b = ct.includes("application/json") ? ((await c.req.json()) as Record<string, unknown>) : await c.req.parseBody();
    for (const [k, v] of Object.entries(b)) if (typeof v === "string") f[k] = v;
  } catch {
    f = {};
  }
  const err = (error: string, desc: string, status: 400 | 401 = 400) => c.json({ error, error_description: desc }, status, { "Cache-Control": "no-store" });
  const clientId = f.client_id || "";
  const orm = getDb(c.env);
  const store = mcpDbOf(orm);
  if (!clientId || !(await getClient(store, clientId))) return err("invalid_client", "Unknown client", 401);

  let userId: number;
  let issued: Awaited<ReturnType<typeof issueTokens>>;
  if (f.grant_type === "authorization_code") {
    if (!f.code || !f.code_verifier) return err("invalid_request", "code and code_verifier are required");
    const rec = await consumeCode(store, f.code);
    if (!rec || rec.clientId !== clientId) return err("invalid_grant", "Code is invalid, used or expired");
    if (f.redirect_uri && f.redirect_uri !== rec.redirectUri) return err("invalid_grant", "redirect_uri mismatch");
    if ((await pkceS256(f.code_verifier)) !== rec.codeChallenge) return err("invalid_grant", "PKCE check failed");
    userId = rec.userId;
    issued = await issueTokens(store, userId, clientId);
  } else if (f.grant_type === "refresh_token") {
    if (!f.refresh_token) return err("invalid_request", "refresh_token is required");
    const r = await refreshTokens(store, f.refresh_token, clientId);
    if (!r) return err("invalid_grant", "Refresh token is invalid, revoked or expired");
    userId = r.userId;
    issued = r;
  } else {
    return err("unsupported_grant_type", "Use authorization_code or refresh_token");
  }
  const u = await loadUser(orm, userId);
  if (!u || !u.active || !(await hasMcpAccess(store, userId, isMcpAdmin(u)))) {
    return err("invalid_grant", "This account may not use the AI connector");
  }
  return c.json(
    { access_token: issued.accessToken, token_type: "Bearer", expires_in: issued.expiresIn, refresh_token: issued.refreshToken, scope: "erp.read" },
    200,
    { "Cache-Control": "no-store", Pragma: "no-cache" },
  );
});

// ── MCP endpoint ────────────────────────────────────────────────────────────

type Identity = { tokenId: string; clientId: string; user: DevUser };
type RpcReq = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

const INSTRUCTIONS = `You are connected to the Houzs IT Hub (the group's IT desk: IT tickets from Hookka, Houzs Century, 2990s, Conts, Houzs Connect and Carres; reports; system health; account ownership and system billing; meeting rooms) as the signed-in IT staff member.
Everything is limited to what this person may see and do in the hub. Reading is free; changes are only the actions below, each confirmed by the person. Never guess figures a call did not return.
ANSWER FAST — use a quick answer first; each is ONE call and already summarised:
- Tickets (how many open / in progress / waiting on the reporter, by system or person; new vs resolved; oldest; high priority): ticket_summary {from?, to?, system?} (default: this month to today, all systems).
- Today at the desk (opened / resolved today by system and category, still open, urgent, overdue): tickets_today {system?, overdueDays?}.
- What do I need to look at today (my tickets, unassigned high priority, my meetings, unread notifications): daily_brief.
- Open tickets filtered by status / priority / system / type / assignee / age: open_tickets. Tickets assigned to me: my_tickets.
- Today's meetings and room bookings: meetings_today {date?}.
- A ticket list as an Excel file: export_excel {list: "tickets", filters...} returns a download link valid 15 minutes.
- Systems down or slow right now, since when, problems the systems report: health_summary.
- Overdue (past SLA, the Reports page's rule) and urgent tickets nobody is assigned to, by system and assignee: tickets_overdue {system?}.
- What the recent tickets are about, short, grouped by system (subject, summary, latest comment): ticket_digest {period?, system?}.
- Records missing something (tickets with no assignee / module, billing charges or accounts with blanks): data_gaps.
- One ticket by code (e.g. HC-0042): fetch {id} directly (status, assignee, the whole history). By words from its title / reporter: search {query} first.
Only when no quick answer fits (billing register, accounts, meeting rooms, ticket lists with filters): list_modules → list_endpoints → erp_get. With erp_get pass "fields" (only the keys you need) and query filters (e.g. /api/v1/dev/tickets with status, system, priority, assignee, q, page_size) to keep replies small.
Periods: tools with "period" take today | week (Monday to today) | month | last_month | quarter | year | custom (with from / to), Malaysia days, and compare with the previous period where cheap.
Dates are Malaysia time (UTC+8). Tickets have no due date. The Reports page's SLA (high 24 h, medium 3 d, low 7 d, not counting time waiting on the reporter) is what tickets_overdue uses; tickets_today / open_tickets "overdue" means open longer than a number of days.
Each person may make ${RATE_LIMITS.perMinute} tool calls a minute and ${RATE_LIMITS.perDay} a day; over that a call says so — wait instead of retrying at once.
If a call says "You do not have permission" or "not available to your role", tell the person they do not have permission for that data.
ACTIONS (only those the admin switched on appear in your tool list): propose_ticket (log a new IT ticket), propose_ticket_comment (comment on a ticket, internal by default), propose_ticket_update (assign and / or change status, including close). They change NOTHING yet — they return a summary and a confirmationId. Show the person that summary word for word and ask them to confirm. Only call confirm_action after they explicitly say yes; if they say no or want changes, call cancel_action (and propose again). Never confirm on your own. Nothing can be deleted, and billing, accounts, users and roles cannot be changed. At most ${ACTIONS_PER_DAY} confirmed actions per person a day.`;

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };
const RO = { readOnlyHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: "ticket_summary",
    title: "Ticket summary (quick answer)",
    description:
      "The IT desk in ONE call: open tickets now by status (open, in progress, on hold, testing, waiting on reporter), by system and by assignee; tickets new and resolved in the date range with median time to resolve; the oldest open tickets; every high-priority open ticket. Same numbers as the Reports page.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", enum: [...PERIODS], description: "today | week | month | last_month | quarter | year | custom (with from / to). Overrides from / to unless custom." },
        from: { type: "string", description: "YYYY-MM-DD. Default: the 1st of this month. Up to 12 months back." },
        to: { type: "string", description: "YYYY-MM-DD. Default: today." },
        system: { type: "string", description: "System code (e.g. HC, HK). Default: all systems." },
      },
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: "tickets_today",
    title: "Tickets today (quick answer)",
    description:
      "Today at the IT desk in ONE call: tickets opened today and resolved today by system (Hookka, Houzs, 2990s, Conts...) and category (type bug / development, module) with their titles; everything still open by system / type / module / status; every urgent (high-priority) open ticket; and the overdue ones (open longer than overdueDays; for the Reports page's SLA use tickets_overdue). Only what this person may see in the hub.",
    inputSchema: {
      type: "object",
      properties: {
        system: { type: "string", description: "System code (e.g. HC, HK). Default: all systems." },
        overdueDays: { type: "number", description: `Open longer than this many days counts as overdue. Default ${OVERDUE_DAYS_DEFAULT}.` },
      },
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: "daily_brief",
    title: "My day (quick answer)",
    description:
      "What this person needs to look at today in ONE call: their open tickets (count, high priority, waiting on the reporter, open over 7 days, top 5), unassigned high-priority tickets, their meetings today and their unread notifications. A part they may not read says so; the rest still answers.",
    inputSchema: NO_ARGS,
    annotations: RO,
  },
  {
    name: "open_tickets",
    title: "Open tickets by filter (quick answer)",
    description:
      "Open tickets matching filters, counted by status, priority, system, age and assignee, with the 10 oldest. Default: every active ticket. Use olderThanDays for 'open longer than N days'; for past SLA use tickets_overdue.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Comma list: active (default), open, in_progress, on_hold, testing, waiting_reporter, resolved, closed, rejected, all" },
        priority: { type: "string", description: "Comma list: high, medium, low" },
        system: { type: "string", description: "Comma list of system codes, e.g. HC,HK" },
        type: { type: "string", description: "bug or development" },
        assignee: { type: "string", description: "me, none (unassigned) or user ids, comma list" },
        olderThanDays: { type: "number", description: "Only tickets raised at least this many days ago" },
      },
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: "my_tickets",
    title: "My tickets (quick answer)",
    description: "The active tickets assigned to this person, most urgent first, with counts by status and priority.",
    inputSchema: NO_ARGS,
    annotations: RO,
  },
  {
    name: "meetings_today",
    title: "Meetings today (quick answer)",
    description: "This person's meetings on a day and every meeting-room booking that day (times in Malaysia time). Default: today.",
    inputSchema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD. Default: today." } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "export_excel",
    title: "Export a list to Excel",
    description: `Build an .xlsx of a hub list as this person sees it and return a download link valid 15 minutes, the row count and whether it was cut at ${EXPORT_ROW_CAP} rows. Lists: "tickets" (filters: status, priority, system, type, assignee, q, from/to on the created date). "fields" picks columns (keys or headers).`,
    inputSchema: {
      type: "object",
      properties: {
        list: { type: "string", enum: ["tickets"], description: "Which list" },
        status: { type: "string", description: "Comma list, default all statuses" },
        priority: { type: "string" },
        system: { type: "string" },
        type: { type: "string" },
        assignee: { type: "string", description: "me, none or user ids" },
        q: { type: "string", description: "Words from the code, title or reporter" },
        from: { type: "string", description: "Created on or after YYYY-MM-DD" },
        to: { type: "string", description: "Created on or before YYYY-MM-DD" },
        fields: { type: "array", items: { type: "string" }, description: "Columns to keep, e.g. [\"code\",\"title\",\"status\"]" },
      },
      required: ["list"],
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: "health_summary",
    title: "System health (quick answer)",
    description: "Which systems are down or slow right now (and since when), 24-hour uptime, and problems the systems report about themselves. ONE call.",
    inputSchema: NO_ARGS,
    annotations: RO,
  },
  {
    name: "search",
    title: "Search tickets",
    description: "Find IT tickets by code (e.g. HC-0042) or by words in the title or the reporter's name, any status. Returns ids to open with fetch.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "A ticket code, or words from its title / reporter name" } }, required: ["query"], additionalProperties: false },
    annotations: RO,
  },
  {
    name: "fetch",
    title: "Open a ticket",
    description: "Ticket lookup: the full ticket for a ticket code (e.g. HC-0042, from search or from the person): what was reported, status, priority, assignee and the whole timeline of comments and changes.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "A ticket code from search, e.g. HC-0042" } }, required: ["id"], additionalProperties: false },
    annotations: RO,
  },
  ...ROUND4_TOOLS,
  ...ACTION_TOOLS,
  { name: "whoami", title: "Who am I connected as", description: "The hub account this connection uses and its roles.", inputSchema: NO_ARGS, annotations: RO },
  { name: "list_modules", title: "List hub modules", description: "The hub's modules (API path prefixes) with how many read endpoints each has. Only when no quick answer fits.", inputSchema: NO_ARGS, annotations: RO },
  {
    name: "list_endpoints",
    title: "List read endpoints",
    description: "Every readable GET endpoint under a module prefix (e.g. /api/v1/dev/billing), with :id style placeholders.",
    inputSchema: { type: "object", properties: { prefix: { type: "string", description: "Module prefix from list_modules" } }, required: ["prefix"], additionalProperties: false },
    annotations: RO,
  },
  {
    name: "erp_get",
    title: "Read from the hub",
    description: `Read one hub endpoint as the signed-in person (GET only) and return its JSON. Pass "fields" to keep only the keys you need; replies over ${MAX_RESULT_CHARS} characters are cut.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Endpoint path without query string, with real ids in place of :id, e.g. /api/v1/dev/tickets" },
        query: { type: "object", description: "Query parameters, e.g. {\"status\":\"active\",\"system\":\"HC\",\"page_size\":20}", additionalProperties: { type: ["string", "number", "boolean"] } },
        fields: { type: "array", items: { type: "string" }, description: "Only keep these keys (at any depth), e.g. [\"code\",\"title\",\"status\",\"assignee_name\"]. Makes big replies small and fast." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: RO,
  },
];

async function innerGet(c: Context<HonoEnv>, token: string, pathWithQuery: string): Promise<Response> {
  if (!appRef) throw new Error("MCP app not initialised");
  let ctx: unknown;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, [MCP_INNER_HEADER]: mcpInnerSecret(), accept: "application/json" };
  const req = new Request(originOf(c) + pathWithQuery, { method: "GET", headers });
  // The inner read uses this request's postgres client (devAuth borrowDb), not a new connection.
  const db = borrowDb(c.req.raw);
  if (db) lendDb(req, db);
  return appRef.fetch(req, c.env, ctx);
}

/**
 * The ONE write a confirmed action makes: the hub's own ticket route, in-process,
 * as the person. Armed for this token + method + path just before the call;
 * devAuth.ts takes the arm once (services/mcp-write-actions.ts). Route and body
 * come from confirmAction, already checked against ACTION_ALLOWLIST and
 * actionBodyAllowed.
 */
async function innerAction(c: Context<HonoEnv>, id: Identity, token: string, actionId: string, route: { method: string; path: string; body: unknown }): Promise<{ status: number; body: unknown }> {
  if (!appRef) throw new Error("MCP app not initialised");
  let ctx: unknown;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  armConfirmedAction(actionId, id.tokenId, route.method, route.path);
  const req = new Request(originOf(c) + route.path, {
    method: route.method,
    headers: {
      authorization: `Bearer ${token}`,
      [MCP_INNER_HEADER]: mcpInnerSecret(),
      [MCP_ACTION_HEADER]: actionId,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(route.body),
  });
  const db = borrowDb(c.req.raw);
  if (db) lendDb(req, db);
  const res = await appRef.fetch(req, c.env, ctx);
  return { status: res.status, body: await res.json().catch(() => null) };
}

type ReadValue =
  | { ok: true; status: number; value: unknown; removed: Set<string>; target: string }
  | { ok: false; status: number; message: string; note: string; target: string };

/** Read one endpoint as the person: gated, then credential fields removed. Shared by erp_get and the quick answers. */
async function readValue(c: Context<HonoEnv>, token: string, rawPath: string, query: Record<string, unknown> | undefined): Promise<ReadValue> {
  const d = classifyPath(rawPath);
  if (!d.ok) return { ok: false, status: 400, message: d.reason, note: "blocked path", target: rawPath };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || typeof v === "object") continue;
    qs.set(k, String(v));
  }
  const target = d.path + (qs.toString() ? `?${qs.toString()}` : "");
  const res = await innerGet(c, token, target);
  const ctype = res.headers.get("content-type") ?? "";
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, message: "Not available to your role: you do not have permission for this in the hub.", note: "no permission", target };
  }
  if (!ctype.includes("json")) {
    return { ok: false, status: res.status, message: `This endpoint returns a file (${ctype || "unknown type"}), not data. Open it in the hub instead.`, note: "non-json", target };
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (res.status >= 400) {
    const msg = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : `HTTP ${res.status}`;
    return { ok: false, status: res.status, message: `The hub answered: ${msg}`, note: msg.slice(0, 120), target };
  }
  const { value, removed } = redactSecrets(body);
  return { ok: true, status: res.status, value, removed, target };
}

/** Read one endpoint as the person; shared with the leak check (routes/mcpAdmin.ts). */
export async function readEndpoint(
  c: Context<HonoEnv>,
  token: string,
  rawPath: string,
  query: Record<string, unknown> | undefined,
  fields: string[] = [],
): Promise<{ result: ToolResult; status: number; note: string; target: string; body: unknown; removed: string[] }> {
  const r = await readValue(c, token, rawPath, query);
  if (!r.ok) return { result: text(r.message, true), status: r.status, note: r.note, target: r.target, body: null, removed: [] };
  let out = JSON.stringify(pickFields(r.value, fields));
  let cut = false;
  if (out.length > MAX_RESULT_CHARS) {
    out = out.slice(0, MAX_RESULT_CHARS);
    cut = true;
  }
  const notes: string[] = [];
  if (r.removed.size) notes.push(`Credential fields removed: ${[...r.removed].join(", ")}.`);
  if (cut) notes.push(`Reply cut at ${MAX_RESULT_CHARS} characters — pass "fields" and narrow it with query parameters (filters, page_size), or use a quick answer (ticket_summary, health_summary, search).`);
  return { result: text((notes.length ? notes.join(" ") + "\n" : "") + out), status: r.status, note: "", target: r.target, body: r.value, removed: [...r.removed] };
}

type Outcome = { result: ToolResult; status: number; note: string; target: string };
const failed = (r: Extract<ReadValue, { ok: false }>, target: string): Outcome => ({ result: text(r.message, true), status: r.status, note: r.note, target });

/** One read of a composite answer: refused / failed reads become a plain "unavailable" line. */
const part = (r: ReadValue, what: string): BriefPart =>
  r.ok ? { ok: true, value: r.value } : { ok: false, message: r.status === 401 || r.status === 403 ? `You do not have access to ${what} in the hub.` : r.message };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const cleanAssignee = (v: unknown): string =>
  String(v ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x === "me" || x === "none" || /^\d{1,9}$/.test(x))
    .join(",");
const cleanQ = (v: unknown): string => String(v ?? "").trim().slice(0, 100);
const qsOf = (o: Record<string, unknown>): string =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
const dropEmpty = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined));

// ── export_excel files ──────────────────────────────────────────────────────
// Stored in R2 (FILES) under mcp-exports/<sha256 of the link token>.xlsx; the
// link carries the random token, so a bucket listing never reveals a link.
// The link works for EXPORT_TTL_MS (checked on download); objects older than a
// day are swept on the next export.
export const EXPORT_TTL_MS = 15 * 60 * 1000;
const EXPORT_PREFIX = "mcp-exports/";
const EXPORT_TOKEN = /^[A-Za-z0-9_-]{32}$/;

async function storeExport(c: Context<HonoEnv>, bytes: Uint8Array, fileName: string, userId: number): Promise<{ url: string; expiresAt: string }> {
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + EXPORT_TTL_MS).toISOString();
  await c.env.FILES.put(`${EXPORT_PREFIX}${await sha256Hex(token)}.xlsx`, bytes, {
    httpMetadata: { contentType: XLSX_TYPE },
    customMetadata: { expiresAt, userId: String(userId), fileName },
  });
  const sweep = (async () => {
    const old = Date.now() - 24 * 3600_000;
    const listed = await c.env.FILES.list({ prefix: EXPORT_PREFIX, limit: 200 });
    const stale = listed.objects.filter((o) => o.uploaded.getTime() < old).map((o) => o.key);
    if (stale.length) await c.env.FILES.delete(stale);
  })().catch((e) => console.warn("[mcp] export sweep failed:", e instanceof Error ? e.message : String(e)));
  try {
    c.executionCtx.waitUntil(sweep);
  } catch {
    /* outside a Worker request */
  }
  return { url: `${originOf(c)}/api/mcp/export/${token}`, expiresAt };
}

/** The real I/O for services/mcp-write-actions.ts: reads as the person and the armed write. */
function actionDeps(c: Context<HonoEnv>, store: McpDb, id: Identity, token: string): ActionDeps {
  return {
    store: mcpActionStore(store),
    tokenId: id.tokenId,
    userId: id.user.id,
    userName: id.user.name,
    origin: originOf(c),
    read: async (path, query) => {
      const r = await readValue(c, token, path, query);
      return r.ok ? { status: r.status, body: r.value } : { status: r.status, body: { error: r.message } };
    },
    write: (actionId, req) => innerAction(c, id, token, actionId, req),
  };
}

const NEXT_STEP = "Nothing has been changed yet. Show this summary to the person and ask them to confirm. Only call confirm_action after they explicitly say yes; otherwise call cancel_action.";

async function runTool(c: Context<HonoEnv>, store: McpDb, id: Identity, token: string, name: string, args: Record<string, unknown>): Promise<Outcome> {
  const ok = (body: unknown, target: string): Outcome => ({ result: text(JSON.stringify(body)), status: 200, note: "", target });
  const bad = (msg: string, target = ""): Outcome => ({ result: text(msg, true), status: 400, note: "", target });

  switch (name) {
    case "ticket_summary": {
      let from = args.from;
      let to = args.to;
      if (args.period !== undefined && args.period !== "") {
        const p = periodWindow(args.period, args.from, args.to, myToday());
        if ("error" in p) return bad(p.error);
        from = p.current.from;
        to = p.current.to;
      }
      const w = ticketWindow(from, to, myToday());
      if ("error" in w) return bad(w.error);
      const system = typeof args.system === "string" && /^[A-Za-z0-9]{1,12}$/.test(args.system.trim()) ? args.system.trim().toUpperCase() : null;
      const target = `tickets:${w.from}..${w.to}${system ? `:${system}` : ""}`;
      // The stats read only adds "assigned to you"; the report alone answers the rest.
      const [report, stats] = await Promise.all([
        readValue(c, token, "/api/v1/dev/tickets/report", { range: w.range }),
        readValue(c, token, "/api/v1/dev/tickets/stats", undefined),
      ]);
      if (!report.ok) return failed(report, target);
      return ok(summariseTickets(report.value, stats.ok ? stats.value : null, w, system), target);
    }
    case "tickets_today": {
      const system = typeof args.system === "string" && /^[A-Za-z0-9]{1,12}$/.test(args.system.trim()) ? args.system.trim().toUpperCase() : null;
      const overdueDays = dayCount(args.overdueDays, OVERDUE_DAYS_DEFAULT);
      const today = myToday();
      const target = `tickets_today:${today}${system ? `:${system}` : ""}`;
      const report = await readValue(c, token, "/api/v1/dev/tickets/report", { range: "this" });
      if (!report.ok) return failed(report, target);
      return ok(summariseTicketsToday(report.value, { today, overdueDays, system, origin: originOf(c) }), target);
    }
    case "open_tickets": {
      const filters = {
        status: cleanList(args.status, TICKET_STATUS_FILTERS) || "active",
        priority: cleanList(args.priority, TICKET_PRIORITY_FILTERS),
        system: cleanSystems(args.system),
        type: cleanList(args.type, TICKET_TYPE_FILTERS),
        assignee: cleanAssignee(args.assignee),
      };
      const olderThanDays = dayCount(args.olderThanDays, 0);
      const target = `open_tickets:${qsOf(filters)}${olderThanDays ? `:>${olderThanDays}d` : ""}`;
      const r = await readValue(c, token, "/api/v1/dev/tickets", dropEmpty({ ...filters, sort: "created", dir: "asc", page_size: 200, page: 1 }));
      if (!r.ok) return failed(r, target);
      return ok(summariseTicketList(r.value, { olderThanDays, origin: originOf(c), filters: dropEmpty(filters) }), target);
    }
    case "my_tickets": {
      const r = await readValue(c, token, "/api/v1/dev/tickets", { assignee: "me", status: "active", sort: "priority", page_size: 100, page: 1 });
      if (!r.ok) return failed(r, "my_tickets");
      return ok(summariseMyTickets(r.value, originOf(c)), "my_tickets");
    }
    case "meetings_today": {
      const day = typeof args.date === "string" && YMD.test(args.date.trim()) ? args.date.trim() : myToday();
      const range = myDayRange(day);
      const target = `meetings:${day}`;
      const [mine, cal] = await Promise.all([
        readValue(c, token, "/api/v1/meetings/mine", undefined),
        readValue(c, token, "/api/v1/meetings/calendar", { from: range.from, to: range.to }),
      ]);
      if (!mine.ok && !cal.ok) return failed(mine, target);
      return ok(
        {
          ...summariseMeetingsDay(mine.ok ? mine.value : null, cal.ok ? cal.value : null, day),
          ...(mine.ok ? {} : { myMeetingsUnavailable: mine.message }),
          ...(cal.ok ? {} : { roomBookingsUnavailable: cal.message }),
        },
        target,
      );
    }
    case "daily_brief": {
      const day = myToday();
      // Four reads as the person, side by side.
      const [mine, high, meetings, notes] = await Promise.all([
        readValue(c, token, "/api/v1/dev/tickets", { assignee: "me", status: "active", sort: "priority", page_size: 100, page: 1 }),
        readValue(c, token, "/api/v1/dev/tickets", { assignee: "none", status: "active", priority: "high", sort: "created", dir: "asc", page_size: 20, page: 1 }),
        readValue(c, token, "/api/v1/meetings/mine", undefined),
        readValue(c, token, "/api/v1/dev/notifications", { unread: "1", page_size: 20, page: 1 }),
      ]);
      return ok(
        buildDailyBrief(
          { mine: part(mine, "tickets"), unassignedHigh: part(high, "tickets"), meetings: part(meetings, "meetings"), notifications: part(notes, "notifications") },
          day,
          originOf(c),
        ),
        `daily_brief:${day}`,
      );
    }
    case "export_excel": {
      const list = String(args.list ?? "");
      if (list !== "tickets") return bad('Unknown list. Lists you can export: "tickets".', `export:${list.slice(0, 40)}`);
      const from = typeof args.from === "string" && YMD.test(args.from) ? args.from : "";
      const to = typeof args.to === "string" && YMD.test(args.to) ? args.to : "";
      if ((args.from && !from) || (args.to && !to)) return bad("Give from and to as YYYY-MM-DD.", "export:tickets");
      const filters = {
        status: cleanList(args.status, TICKET_STATUS_FILTERS) || "all",
        priority: cleanList(args.priority, TICKET_PRIORITY_FILTERS),
        system: cleanSystems(args.system),
        type: cleanList(args.type, TICKET_TYPE_FILTERS),
        assignee: cleanAssignee(args.assignee),
        q: cleanQ(args.q),
      };
      const target = `export:tickets:${qsOf({ ...filters, from, to })}`.slice(0, 480);
      const PAGE = 200;
      const rows: Record<string, unknown>[] = [];
      let truncated = false;
      const removed = new Set<string>();
      for (let page = 1; ; page++) {
        // eslint-disable-next-line no-await-in-loop -- pages in order: newest first, stop at the "from" date or the cap
        const r = await readValue(c, token, "/api/v1/dev/tickets", dropEmpty({ ...filters, sort: "created", dir: "desc", page_size: PAGE, page }));
        if (!r.ok) {
          if (page === 1) return failed(r, target);
          truncated = true;
          break;
        }
        for (const k of r.removed) removed.add(k);
        const v = (r.value ?? {}) as Record<string, unknown>;
        const got = Array.isArray(v.tickets) ? (v.tickets as Record<string, unknown>[]) : [];
        const total = Number(v.total) || 0;
        let pastFrom = false;
        for (const t of got) {
          if (!inCreatedRange(t, from, "")) {
            pastFrom = true; // newest first: everything after this is older than "from"
            break;
          }
          if (!inCreatedRange(t, "", to)) continue;
          if (rows.length >= EXPORT_ROW_CAP) {
            truncated = true;
            break;
          }
          rows.push(t);
        }
        if (truncated || pastFrom || got.length < PAGE || page * PAGE >= total) break;
      }
      const columns = pickColumns(TICKET_EXPORT_COLUMNS, args.fields);
      const fileName = exportFileName("tickets", myToday());
      const bytes = await buildXlsx("Tickets", columns, rows);
      const link = await storeExport(c, bytes, fileName, id.user.id);
      return {
        result: text(
          JSON.stringify({
            download: link.url,
            fileName,
            rows: rows.length,
            truncated,
            ...(truncated ? { note: `Cut at ${EXPORT_ROW_CAP} rows — narrow the filters or the date range for the rest.` } : {}),
            linkExpiresAt: link.expiresAt,
            linkValidMinutes: EXPORT_TTL_MS / 60_000,
            columns: columns.map((col) => col.header),
            ...(removed.size ? { credentialFieldsRemoved: [...removed] } : {}),
          }),
        ),
        status: 200,
        note: `${rows.length} rows${truncated ? ", truncated" : ""}, ${bytes.length} bytes`,
        target,
      };
    }
    case "health_summary": {
      const h = await readValue(c, token, "/api/v1/dev/health", undefined);
      if (!h.ok) return failed(h, "health");
      return ok(summariseHealth(h.value), "health");
    }
    case "search": {
      const q = String(args.query ?? args.q ?? "").trim().slice(0, 100);
      const target = `search:${q}`;
      if (!q) return bad("Give a ticket code or a few words to search for.", target);
      const r = await readValue(c, token, "/api/v1/dev/tickets", { q, status: "all", sort: "updated", page_size: 10, page: 1 });
      if (!r.ok) return failed(r, target);
      return ok({ results: ticketSearchResults(r.value, originOf(c)) }, target);
    }
    case "fetch": {
      const code = String(args.id ?? "").trim();
      const target = `fetch:${code}`;
      if (!TICKET_CODE.test(code)) return bad("Give a ticket code from search, e.g. HC-0042.", target);
      const r = await readValue(c, token, `/api/v1/dev/tickets/${encodeURIComponent(code)}`, undefined);
      if (!r.ok) return failed(r, target);
      return ok(ticketDocument(r.value, originOf(c), MAX_RESULT_CHARS), target);
    }
    case "propose_ticket":
    case "propose_ticket_comment":
    case "propose_ticket_update": {
      const o = await proposeAction(actionDeps(c, store, id, token), TOOL_ACTION[name], args);
      if (!o.ok) return { result: text(o.text, true), status: o.status, note: "", target: o.target };
      return ok({ confirmationId: o.confirmationId, summary: o.summary, warnings: o.warnings, expiresInMinutes: o.expiresInMinutes, next: NEXT_STEP }, o.target);
    }
    case "confirm_action":
    case "cancel_action": {
      const deps = actionDeps(c, store, id, token);
      const o = name === "confirm_action" ? await confirmAction(deps, args.confirmationId) : await cancelAction(deps, args.confirmationId);
      if (o.ok && name === "confirm_action") answerCache.dropUser(id.user.id);
      return { result: text(o.text, !o.ok), status: o.status, note: name === "confirm_action" ? (o.ok ? "done" : `refused ${o.status}`) : "", target: o.target };
    }
    case "whoami": {
      const sw = await mcpActionStore(store).switches();
      const actions = WRITE_ACTIONS.filter((a) => sw.main && sw[a] && (id.user.perms as readonly string[]).includes(ACTION_PERMISSION[a]));
      return ok({ name: id.user.name, email: id.user.email, roles: id.user.roleName, readOnly: actions.length === 0, actions }, "");
    }
    case "list_modules":
      return ok(
        {
          readOnly: true,
          modules: moduleCatalog(mcpAppRoutes()),
          tip: "Prefer ticket_summary / health_summary / search first. Otherwise call list_endpoints with a prefix, then erp_get. A module you may not open answers 'not available to your role'.",
        },
        "",
      );
    case "list_endpoints": {
      const prefix = String(args.prefix ?? "");
      const d = classifyPath(prefix);
      if (!d.ok) return bad(d.reason, prefix);
      return ok({ prefix: d.path, endpoints: readablePaths(mcpAppRoutes(), d.path).slice(0, 300) }, prefix);
    }
    case "erp_get": {
      const fields = Array.isArray(args.fields) ? (args.fields as unknown[]).map(String).filter(Boolean).slice(0, 40) : [];
      const r = await readEndpoint(c, token, String(args.path ?? ""), (args.query as Record<string, unknown> | undefined) ?? undefined, fields);
      return { result: r.result, status: r.status, note: r.note, target: r.target };
    }
    default: {
      // Round 4 (services/mcp-round4.ts): reads only through readValue, as the person.
      const r4 = await runRound4Tool(name, args, { read: (p, q) => readValue(c, token, p, q), origin: originOf(c), today: myToday(), nowMs: Date.now() });
      if (!r4) return bad(`Unknown tool: ${name}`);
      return r4.ok ? ok(r4.body, r4.target) : { result: text(r4.message, true), status: r4.status, note: r4.note, target: r4.target };
    }
  }
}

// ── round 4c: visibility (P1), structured output (P3 + P5), cache (P4) ──────

const NO_SWITCHES: Switches = { main: false };
const WRITE_META = { toolAction: TOOL_ACTION, permission: ACTION_PERMISSION, actions: WRITE_ACTIONS };
const allowedFor = (u: DevUser, sw: Switches) => (name: string) => toolAllowed(name, u.perms, sw, WRITE_META);

async function visibleTools(store: McpDb, u: DevUser): Promise<Record<string, unknown>[]> {
  const ok = allowedFor(u, await mcpActionStore(store).switches());
  return TOOLS.filter((t) => ok(t.name)).map((t) => (STRUCTURED_TOOLS.has(t.name) ? { ...t, outputSchema: QUICK_OUTPUT_SCHEMA } : t));
}

const ALL_PROMPTS = [DAILY_BRIEF_PROMPT, ...PROMPTS, ...ROLE_PROMPTS];

/** A prompt is listed when the first tool it uses is listed for the person. */
function visiblePrompts(u: DevUser): typeof ALL_PROMPTS {
  const ok = allowedFor(u, NO_SWITCHES);
  return ALL_PROMPTS.filter((p) => ok((PROMPT_TOOLS[p.name] ?? [""])[0]));
}

/** The answer's JSON as structuredContent (with hubLink + row urls); the text carries the same JSON. */
function structured(name: string, r: ToolResult, origin: string): ToolResult {
  const raw = r.content[0]?.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...r, structuredContent: { text: raw, truncated: true } };
  }
  const value = withHubLinks(name, parsed, origin);
  return { ...r, content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

const answerCache = new AnswerCache<Outcome>();

async function callTool(c: Context<HonoEnv>, store: McpDb, id: Identity, token: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const t0 = Date.now();
  let o: Outcome;
  try {
    // Per person, tool calls only (initialize / tools/list / prompts are free). The admin
    // leak check reads through readEndpoint, never through here, so it is never limited.
    const refused = rateLimitMessage(await countRecentCalls(store, id.user.id));
    if (refused) {
      o = { result: text(refused, true), status: 429, note: "rate limited", target: "" };
    } else {
      // Round 4c P1: a tool hidden from this person's tools/list answers "no access"
      // when called directly — the same check the list uses. Action tools keep their
      // own plain refusals (switched off) unless the person lacks the route's permission.
      const known = TOOLS.some((t) => t.name === name);
      const isAction = Object.hasOwn(TOOL_ACTION, name) || name === "confirm_action" || name === "cancel_action";
      if (known && !isAction && !allowedFor(id.user, NO_SWITCHES)(name)) {
        o = { result: text(`You do not have access to this in the hub (${name} needs the "${needLabel(name)}" permission).`, true), status: 403, note: "no permission", target: name };
      } else if (isAction && !WRITE_ACTIONS.some((a) => (id.user.perms as readonly string[]).includes(ACTION_PERMISSION[a]))) {
        o = { result: text('You do not have access to this in the hub (AI actions on tickets need the "IT tickets" permission).', true), status: 403, note: "no permission", target: name };
      } else {
        // P4: heavy summaries reused for 60 s per person + permissions + arguments.
        const key = CACHEABLE_TOOLS.has(name) ? AnswerCache.key(id.user.id, id.user.perms, name, args) : "";
        const hit = key ? answerCache.get(key) : null;
        if (hit) {
          o = { ...hit, note: hit.note ? `cached,${hit.note}` : "cached" };
        } else {
          o = await runTool(c, store, id, token, name, args);
          // P3 + P5: a quick answer also as structuredContent, with hub links.
          if (STRUCTURED_TOOLS.has(name) && !o.result.isError) o = { ...o, result: structured(name, o.result, originOf(c)) };
          if (key && !o.result.isError && o.status === 200) answerCache.set(key, o);
        }
      }
    }
  } catch (e) {
    o = { result: text(`Failed: ${e instanceof Error ? e.message : String(e)}`, true), status: 500, note: "", target: "" };
  }
  // Awaited, not waitUntil: the next call in this request must count this one.
  await logCall(store, { tokenId: id.tokenId, userId: id.user.id, clientId: id.clientId, tool: name, target: o.target, status: o.status, ok: !o.result.isError, note: o.note, ms: Date.now() - t0 });
  return o.result;
}

async function handleRpc(c: Context<HonoEnv>, store: McpDb, id: Identity, token: string, m: RpcReq): Promise<unknown> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: m.id ?? null, result });
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "");
      const protocolVersion = MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return reply({ protocolVersion, capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: await visibleTools(store, id.user) });
    case "tools/call":
      return reply(await callTool(c, store, id, token, String(m.params?.name ?? ""), (m.params?.arguments as Record<string, unknown> | undefined) ?? {}));
    case "resources/list":
      return reply({ resources: [] });
    case "prompts/list":
      return reply({ prompts: visiblePrompts(id.user) });
    case "prompts/get": {
      const pname = String(m.params?.name ?? "");
      const pargs = (m.params?.arguments as Record<string, unknown> | undefined) ?? {};
      const visible = visiblePrompts(id.user).some((x) => x.name === pname);
      const ptext = !visible ? null : pname === DAILY_BRIEF_PROMPT.name ? DAILY_BRIEF_TEXT : (promptText(pname, pargs) ?? rolePromptText(pname, pargs));
      if (ptext === null) return { jsonrpc: "2.0", id: m.id ?? null, error: { code: -32602, message: `Unknown prompt: ${pname}` } };
      return reply({ description: ALL_PROMPTS.find((x) => x.name === pname)?.description ?? "", messages: [{ role: "user", content: { type: "text", text: ptext } }] });
    }
    default:
      if (m.id === undefined || m.id === null || (m.method ?? "").startsWith("notifications/")) return null;
      return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `Method not found: ${m.method ?? ""}` } };
  }
}

/** The person behind a connector token, or null (unknown / revoked / inactive / password change pending / access removed). */
export async function mcpIdentity(orm: DB, token: string): Promise<Identity | null> {
  const store = mcpDbOf(orm);
  const row = await resolveAccessToken(store, token);
  if (!row) return null;
  const user = await loadUser(orm, row.userId);
  if (!user || !user.active || user.mustChangePassword) return null;
  if (!(await hasMcpAccess(store, user.id, isMcpAdmin(user)))) return null;
  return { tokenId: row.tokenId, clientId: row.clientId, user };
}

app.post("/", async (c) => {
  const token = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  // One postgres client for this request: the door check and the call log share it.
  const orm = getDb(c.env);
  const id = token ? await mcpIdentity(orm, token) : null;
  if (!id) {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, 401, {
      "WWW-Authenticate": `Bearer realm="houzs-it-hub", resource_metadata="${originOf(c)}/.well-known/oauth-protected-resource/api/mcp"${token ? ', error="invalid_token"' : ""}`,
    });
  }
  // The inner reads of this request reuse this check instead of repeating it
  // (devAuth.ts recallVerified) — one token check per lookup, not two.
  rememberVerified(token, id);
  lendDb(c.req.raw, orm);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const store = mcpDbOf(orm);
  const msgs = Array.isArray(body) ? (body as RpcReq[]) : [body as RpcReq];
  if (msgs.length > MAX_BATCH) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `At most ${MAX_BATCH} messages in one batch.` } }, 400);
  const out: unknown[] = [];
  for (const m of msgs) {
    const r = await handleRpc(c, store, id, token, m);
    if (r) out.push(r);
  }
  if (out.length === 0) return c.body(null, 202);
  return c.json(Array.isArray(body) ? out : out[0]);
});

// export_excel downloads: the 15-minute link handed back by the tool. The random
// token in the path is the only key (its SHA-256 names the R2 object).
app.get("/export/:token", async (c) => {
  const tok = c.req.param("token");
  const gone = () => plain("This download link has expired. Ask the AI for the export again.", 400);
  if (!EXPORT_TOKEN.test(tok)) return gone();
  const obj = await c.env.FILES.get(`${EXPORT_PREFIX}${await sha256Hex(tok)}.xlsx`);
  if (!obj) return gone();
  const exp = Date.parse(obj.customMetadata?.expiresAt ?? "");
  if (!Number.isFinite(exp) || exp < Date.now()) return gone();
  const name = (obj.customMetadata?.fileName ?? "export.xlsx").replace(/[^A-Za-z0-9._-]/g, "");
  return new Response(obj.body, {
    headers: { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
});

// Stateless server: no server-initiated stream.
app.get("/", (c) => c.json({ error: "Use POST (MCP Streamable HTTP)." }, 405, { Allow: "POST" }));
app.delete("/", (c) => c.body(null, 405, { Allow: "POST" }));

export default app;
