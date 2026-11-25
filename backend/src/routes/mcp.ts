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
// READ-ONLY and OWN-PERMISSIONS by construction: a tool call re-enters the
// whole app as a GET carrying the person's MCP token. middleware/devAuth.ts
// accepts an hbmcp_ token ONLY on that in-process call (a per-isolate secret
// header nobody outside can know) and ONLY for GET/HEAD, then runs every route
// as the real person — their roles and permissions.
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
import { classifyPath, moduleCatalog, readablePaths, redactSecrets, type RouteInfo } from "../services/mcp-access";
import {
  consumeCode,
  createAuthRequest,
  getClient,
  hasMcpAccess,
  issueTokens,
  logCall,
  MCP_ADMIN_PERMISSION,
  pkceS256,
  refreshTokens,
  registerClient,
  resolveAccessToken,
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
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

const INSTRUCTIONS = `You are connected to the Houzs IT Hub (the group's IT desk: IT tickets from Hookka, Houzs Century, 2990s, Conts, Houzs Connect and Carres; reports; system health; account ownership and system billing; meeting rooms) as the signed-in IT staff member.
Everything is READ-ONLY and limited to what this person may see in the hub. Never guess figures a call did not return.
ANSWER FAST — use a quick answer first; each is ONE call and already summarised:
- Tickets (how many open / in progress / waiting on the reporter, by system or person; new vs resolved; oldest; high priority): ticket_summary {from?, to?, system?} (default: this month to today, all systems).
- Systems down or slow right now, since when, problems the systems report: health_summary.
- One ticket by code (e.g. HC-0042) or words from its title / reporter: search {query}, then fetch {id} for the full ticket with its timeline.
Only when no quick answer fits (billing register, accounts, meeting rooms, ticket lists with filters): list_modules → list_endpoints → erp_get. With erp_get pass "fields" (only the keys you need) and query filters (e.g. /api/v1/dev/tickets with status, system, priority, assignee, q, page_size) to keep replies small.
Dates are Malaysia time (UTC+8).
If a call says "You do not have permission" or "not available to your role", tell the person they do not have permission for that data.`;

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
        from: { type: "string", description: "YYYY-MM-DD. Default: the 1st of this month. Up to 12 months back." },
        to: { type: "string", description: "YYYY-MM-DD. Default: today." },
        system: { type: "string", description: "System code (e.g. HC, HK). Default: all systems." },
      },
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
    description: "The full ticket for an id returned by search (its ticket code): what was reported, status, priority, assignee and the whole timeline of comments and changes.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "A ticket code from search, e.g. HC-0042" } }, required: ["id"], additionalProperties: false },
    annotations: RO,
  },
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

async function runTool(c: Context<HonoEnv>, id: Identity, token: string, name: string, args: Record<string, unknown>): Promise<Outcome> {
  const ok = (body: unknown, target: string): Outcome => ({ result: text(JSON.stringify(body)), status: 200, note: "", target });
  const bad = (msg: string, target = ""): Outcome => ({ result: text(msg, true), status: 400, note: "", target });

  switch (name) {
    case "ticket_summary": {
      const w = ticketWindow(args.from, args.to, myToday());
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
    case "whoami":
      return ok({ name: id.user.name, email: id.user.email, roles: id.user.roleName, readOnly: true }, "");
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
    default:
      return bad(`Unknown tool: ${name}`);
  }
}

async function callTool(c: Context<HonoEnv>, store: McpDb, id: Identity, token: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const t0 = Date.now();
  let o: Outcome;
  try {
    o = await runTool(c, id, token, name, args);
  } catch (e) {
    o = { result: text(`Failed: ${e instanceof Error ? e.message : String(e)}`, true), status: 500, note: "", target: "" };
  }
  const done = logCall(store, { tokenId: id.tokenId, userId: id.user.id, clientId: id.clientId, tool: name, target: o.target, status: o.status, ok: !o.result.isError, note: o.note, ms: Date.now() - t0 });
  try {
    c.executionCtx.waitUntil(done);
  } catch {
    await done;
  }
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
      return reply({ tools: TOOLS });
    case "tools/call":
      return reply(await callTool(c, store, id, token, String(m.params?.name ?? ""), (m.params?.arguments as Record<string, unknown> | undefined) ?? {}));
    case "resources/list":
      return reply({ resources: [] });
    case "prompts/list":
      return reply({ prompts: PROMPTS });
    case "prompts/get": {
      const pname = String(m.params?.name ?? "");
      const ptext = promptText(pname, (m.params?.arguments as Record<string, unknown> | undefined) ?? {});
      if (ptext === null) return { jsonrpc: "2.0", id: m.id ?? null, error: { code: -32602, message: `Unknown prompt: ${pname}` } };
      return reply({ description: PROMPTS.find((x) => x.name === pname)?.description ?? "", messages: [{ role: "user", content: { type: "text", text: ptext } }] });
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
  const out: unknown[] = [];
  for (const m of msgs) {
    const r = await handleRpc(c, store, id, token, m);
    if (r) out.push(r);
  }
  if (out.length === 0) return c.body(null, 202);
  return c.json(Array.isArray(body) ? out : out[0]);
});

// Stateless server: no server-initiated stream.
app.get("/", (c) => c.json({ error: "Use POST (MCP Streamable HTTP)." }, 405, { Allow: "POST" }));
app.delete("/", (c) => c.body(null, 405, { Allow: "POST" }));

export default app;
