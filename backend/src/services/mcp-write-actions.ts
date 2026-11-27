// ---------------------------------------------------------------------------
// mcp-write-actions.ts — AI Connector round 4b: write actions (owner approved
// 2026-11-26). Same design as Hookka's (#1633): propose → the person sees a
// summary → confirm_action → ONE call to the hub's OWN existing route,
// in-process, AS the person. The route's need("it"), validation and timeline
// (ticket_events, the hub's audit trail for tickets) decide and record.
//
//   propose_ticket          POST  /api/v1/dev/tickets               (need "it")
//                           — the New ticket dialog's fields: system_code, title,
//                           description, type, priority, reporter_name.
//   propose_ticket_comment  POST  /api/v1/dev/tickets/:code/comments (need "it")
//                           — body + visibility (public | internal), no files.
//   propose_ticket_update   PATCH /api/v1/dev/tickets/:code          (need "it")
//                           — assignee_id and / or status (incl. closed), the
//                           ticket page's Assignee picker and Status button.
//
// Never: delete (ticket or comment), pickup / reorder, priority / type / module
// edits, billing, accounts, users, roles, health targets.
//
// Guards, in order, on confirm_action: the main "Allow AI actions" switch → the
// daily cap (ACTIONS_PER_DAY confirmed actions per person per Malaysia day) →
// the action's own switch (peeked, so a switched-off action is refused without
// using up the id) → the single-use claim (same token + person, 10 minutes) →
// a stale check (update: the ticket's status / assignee must still be what the
// summary showed) → the write fence (route + body keys) → the ONE armed write.
//
// The FENCE (ACTION_ALLOWLIST, actionBodyAllowed, arm / take) lives here too so
// this file has no runtime imports and is unit-tested directly under node
// (backend/test/mcp-4bc.test.mjs). middleware/devAuth.ts lets an hbmcp_ token
// make a non-GET request ONLY when takeConfirmedAction() says yes, once.
//
// Tables: migration 025_mcp_write_actions.sql (mcp_settings, mcp_pending_actions).
// ---------------------------------------------------------------------------
import type { McpDb } from "./mcp-db";

type Obj = Record<string, unknown>;

export const ACTION_TTL_MS = 10 * 60 * 1000;
export const ACTIONS_PER_DAY = 30;
export const MAIN_SWITCH = "actions_enabled";
export const ACTIONS_OFF_MESSAGE = "AI actions are switched off by your admin.";

export const WRITE_ACTIONS = ["ticket", "ticket_comment", "ticket_update"] as const;
export type WriteAction = (typeof WRITE_ACTIONS)[number];
export const WRITE_ACTION_LABELS: Record<WriteAction, string> = {
  ticket: "Create IT tickets",
  ticket_comment: "Comment on tickets",
  ticket_update: "Assign tickets and change their status (including close)",
};
export const switchKey = (a: WriteAction): string => `action_${a}`;
export const actionOffMessage = (a: WriteAction): string => `"${WRITE_ACTION_LABELS[a]}" is switched off by your admin.`;

/** The propose tool for each action. */
export const ACTION_TOOL: Record<WriteAction, string> = {
  ticket: "propose_ticket",
  ticket_comment: "propose_ticket_comment",
  ticket_update: "propose_ticket_update",
};
export const TOOL_ACTION: Record<string, WriteAction> = Object.fromEntries(WRITE_ACTIONS.map((a) => [ACTION_TOOL[a], a]));

/** The hub permission each action's route checks (dev.ts: dev.use("/tickets/*", need("it"))). */
export const ACTION_PERMISSION: Record<WriteAction, string> = { ticket: "it", ticket_comment: "it", ticket_update: "it" };

// Mirrors db/schema.ts (kept here so this file has no runtime imports; a test checks they match).
export const TICKET_STATUSES = ["open", "in_progress", "on_hold", "testing", "waiting_reporter", "resolved", "closed", "rejected"] as const;
export const TICKET_PRIORITIES = ["high", "medium", "low"] as const;
export const TICKET_TYPES = ["bug", "development"] as const;
const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  testing: "Testing",
  waiting_reporter: "Waiting on reporter",
  resolved: "Resolved",
  closed: "Closed",
  rejected: "Rejected",
};

export const MAX_TITLE = 200;
export const MAX_TEXT = 10_000;
export const MAX_REPORTER = 120;

// ── the write fence ─────────────────────────────────────────────────────────

export const MCP_ACTION_HEADER = "x-hub-mcp-action";
const CODE = "[A-Za-z0-9]{1,12}-[A-Za-z0-9-]{1,20}"; // mcp-quick.ts TICKET_CODE
const CODE_RE = new RegExp(`^${CODE}$`);

/** The ONLY non-GET requests an hbmcp_ token can ever make. `:code` = one ticket code. */
export const ACTION_ALLOWLIST: readonly { kind: WriteAction; method: "POST" | "PATCH"; path: string }[] = [
  { kind: "ticket", method: "POST", path: "/api/v1/dev/tickets" },
  { kind: "ticket_comment", method: "POST", path: "/api/v1/dev/tickets/:code/comments" },
  { kind: "ticket_update", method: "PATCH", path: "/api/v1/dev/tickets/:code" },
];
const ALLOW_RE = ACTION_ALLOWLIST.map((a) => ({ ...a, re: new RegExp(`^${a.path.replace(":code", CODE)}$`) }));

/** The concrete route for an action (`code` fills `:code`), or null for an unknown kind / unsafe code. */
export function allowlistedAction(kind: string, code = ""): { method: "POST" | "PATCH"; path: string } | null {
  const e = ACTION_ALLOWLIST.find((a) => a.kind === kind);
  if (!e) return null;
  if (!e.path.includes(":code")) return { method: e.method, path: e.path };
  if (!CODE_RE.test(code)) return null;
  return { method: e.method, path: e.path.replace(":code", code) };
}

export function isAllowlisted(method: string, path: string): boolean {
  return ALLOW_RE.some((a) => a.method === method.toUpperCase() && a.re.test(path));
}

/** The keys each action's body may carry: exactly what the hub screen sends for it. */
export const BODY_KEYS: Record<WriteAction, readonly string[]> = {
  ticket: ["system_code", "title", "description", "type", "priority", "reporter_name"],
  ticket_comment: ["body", "visibility"],
  ticket_update: ["assignee_id", "status"],
};

const isStr = (v: unknown, max: number, required = false): boolean => (v === undefined && !required) || (typeof v === "string" && v.length <= max && (!required || v.trim().length > 0));
const isOneOf = (v: unknown, list: readonly string[]): boolean => typeof v === "string" && list.includes(v);

/** True when `body` is a plain object carrying only the keys (and value shapes) `kind` may send. */
export function actionBodyAllowed(kind: string, body: unknown): boolean {
  if (!(WRITE_ACTIONS as readonly string[]).includes(kind)) return false;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const b = body as Obj;
  const keys = BODY_KEYS[kind as WriteAction];
  if (Object.keys(b).length === 0 || !Object.keys(b).every((k) => keys.includes(k))) return false;
  if (kind === "ticket") {
    return (
      isStr(b.system_code, 20, true) &&
      isStr(b.title, MAX_TITLE, true) &&
      isStr(b.description, MAX_TEXT) &&
      isStr(b.reporter_name, MAX_REPORTER, true) &&
      (b.type === undefined || isOneOf(b.type, TICKET_TYPES)) &&
      (b.priority === undefined || isOneOf(b.priority, TICKET_PRIORITIES))
    );
  }
  if (kind === "ticket_comment") return isStr(b.body, MAX_TEXT, true) && isOneOf(b.visibility, ["public", "internal"]);
  // ticket_update
  if (b.status !== undefined && !isOneOf(b.status, TICKET_STATUSES)) return false;
  if (b.assignee_id !== undefined && b.assignee_id !== null && !(Number.isInteger(b.assignee_id) && (b.assignee_id as number) > 0)) return false;
  return true;
}

const ARM_TTL_MS = 30_000;
const armed = new Map<string, { tokenId: string; method: string; path: string; exp: number }>();

/** confirm_action, after it claimed the pending row: allow exactly one matching write. */
export function armConfirmedAction(actionId: string, tokenId: string, method: string, path: string, now = Date.now()): void {
  if (!actionId || !isAllowlisted(method, path)) return;
  for (const [k, v] of armed) if (v.exp <= now) armed.delete(k);
  armed.set(actionId, { tokenId, method: method.toUpperCase(), path, exp: now + ARM_TTL_MS });
}

/** middleware/devAuth.ts: true ONCE, for the armed action's own token + method + path. */
export function takeConfirmedAction(actionId: string | undefined | null, tokenId: string, method: string, path: string, now = Date.now()): boolean {
  if (!actionId) return false;
  const e = armed.get(actionId);
  if (!e) return false;
  armed.delete(actionId);
  return e.exp > now && e.tokenId === tokenId && e.method === method.toUpperCase() && e.path === path && isAllowlisted(method, path);
}

// ── storage (an interface, so tests use an in-memory one) ───────────────────

export type PendingRow = { kind: WriteAction; payload: Obj; summary: string };

export interface ActionStore {
  switches(): Promise<{ main: boolean } & Record<WriteAction, boolean>>;
  confirmedSince(userId: number, sinceIso: string): Promise<number>;
  create(a: { id: string; tokenId: string; userId: number; kind: WriteAction; payload: Obj; summary: string; expiresAt: string }): Promise<void>;
  peekKind(id: string, tokenId: string, userId: number, nowIso: string): Promise<WriteAction | null>;
  claim(id: string, tokenId: string, userId: number, nowIso: string): Promise<PendingRow | null>;
  finish(id: string, status: number, note: string): Promise<void>;
  cancel(id: string, tokenId: string, userId: number, nowIso: string): Promise<boolean>;
}

const isAction = (k: unknown): k is WriteAction => typeof k === "string" && (WRITE_ACTIONS as readonly string[]).includes(k);

/** The real store, over the connector's postgres client (tables: migration 025). A missing table reads as "switched off". */
export function mcpActionStore(db: McpDb): ActionStore {
  return {
    async switches() {
      const off = { main: false, ticket: false, ticket_comment: false, ticket_update: false };
      try {
        const r = await db.prepare("SELECT key, enabled FROM mcp_settings").all<Obj>();
        const on = new Set(r.results.filter((x) => Number(x.enabled) === 1).map((x) => String(x.key)));
        return { main: on.has(MAIN_SWITCH), ticket: on.has(switchKey("ticket")), ticket_comment: on.has(switchKey("ticket_comment")), ticket_update: on.has(switchKey("ticket_update")) };
      } catch (e) {
        console.warn("[mcp] switches unreadable (treated as off):", e instanceof Error ? e.message : String(e));
        return off;
      }
    },
    async confirmedSince(userId, sinceIso) {
      const r = await db.prepare("SELECT COUNT(*) AS n FROM mcp_pending_actions WHERE user_id = ? AND used_at >= ?").bind(userId, sinceIso).first<Obj>();
      return Number(r?.n ?? 0);
    },
    async create(a) {
      await db
        .prepare(
          `INSERT INTO mcp_pending_actions (id, token_id, user_id, kind, payload_json, summary, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(a.id, a.tokenId, a.userId, a.kind, JSON.stringify(a.payload), a.summary.slice(0, 2000), new Date().toISOString(), a.expiresAt)
        .run();
    },
    async peekKind(id, tokenId, userId, nowIso) {
      const r = await db
        .prepare("SELECT kind FROM mcp_pending_actions WHERE id = ? AND token_id = ? AND user_id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?")
        .bind(id, tokenId, userId, nowIso)
        .first<Obj>();
      return r && isAction(r.kind) ? r.kind : null;
    },
    async claim(id, tokenId, userId, nowIso) {
      // Single use: the UPDATE … RETURNING claims the row or returns nothing.
      const r = await db
        .prepare(
          `UPDATE mcp_pending_actions SET used_at = ?
            WHERE id = ? AND token_id = ? AND user_id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?
            RETURNING kind, payload_json, summary`,
        )
        .bind(nowIso, id, tokenId, userId, nowIso)
        .first<Obj>();
      if (!r || !isAction(r.kind)) return null;
      let payload: Obj = {};
      try {
        payload = JSON.parse(String(r.payload_json ?? "{}")) as Obj;
      } catch {
        payload = {};
      }
      return { kind: r.kind, payload, summary: String(r.summary ?? "") };
    },
    async finish(id, status, note) {
      // Keep the outcome; drop the payload (comment / description text) once it ran.
      try {
        await db.prepare("UPDATE mcp_pending_actions SET result_status = ?, result_note = ?, payload_json = '{}' WHERE id = ?").bind(status, note.slice(0, 300), id).run();
      } catch (e) {
        console.warn("[mcp] finish action failed:", e instanceof Error ? e.message : String(e));
      }
    },
    async cancel(id, tokenId, userId, nowIso) {
      const r = await db
        .prepare("UPDATE mcp_pending_actions SET cancelled_at = ?, payload_json = '{}' WHERE id = ? AND token_id = ? AND user_id = ? AND used_at IS NULL AND cancelled_at IS NULL")
        .bind(nowIso, id, tokenId, userId)
        .run();
      return r.count > 0;
    },
  };
}

/** The admin page's switch write (routes/mcpAdmin.ts). */
export async function setActionSwitch(db: McpDb, key: string, enabled: boolean, by: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mcp_settings (key, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    )
    .bind(key, enabled ? 1 : 0, by, new Date().toISOString())
    .run();
}

export const SWITCH_KEYS: readonly string[] = [MAIN_SWITCH, ...WRITE_ACTIONS.map(switchKey)];

// ── helpers ─────────────────────────────────────────────────────────────────

const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const one = (v: unknown, max: number): string => s(v).replace(/\s+/g, " ").trim().slice(0, max);
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

/** 00:00 Malaysia time (UTC+8) of the day `nowMs` falls in, as an ISO instant. */
export function myDayStartIso(nowMs: number): string {
  const my = new Date(nowMs + 8 * 3600_000);
  return new Date(Date.UTC(my.getUTCFullYear(), my.getUTCMonth(), my.getUTCDate()) - 8 * 3600_000).toISOString();
}

export function newActionId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return "mcpa_" + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
export const ACTION_ID = /^mcpa_[a-f0-9]{24}$/;

export const ticketLink = (origin: string, code: string) => `${origin}/tickets/${encodeURIComponent(code)}`;

// ── deps: the real I/O comes from routes/mcp.ts ─────────────────────────────

export type Reply = { status: number; body: unknown };
export type ActionDeps = {
  store: ActionStore;
  tokenId: string;
  userId: number;
  userName: string;
  origin: string;
  /** GET as the person (routes/mcp.ts readValue: the read gate + the route's own permission). */
  read: (path: string, query?: Record<string, unknown>) => Promise<Reply>;
  /** The ONE armed in-process write as the person (routes/mcp.ts innerAction). */
  write: (actionId: string, req: { method: string; path: string; body: Obj }) => Promise<Reply>;
  now?: () => number;
};

export type Outcome = { ok: boolean; text: string; status: number; target: string; body?: Obj };

const errText = (body: unknown, status: number): string => {
  const e = obj(body).error;
  return typeof e === "string" && e ? e : `HTTP ${status}`;
};

/** A refused read → the plain line the person sees. */
function readRefusal(r: Reply, what: string): string {
  if (r.status === 401 || r.status === 403) return `Not available to your role: you do not have permission for ${what} in the hub.`;
  if (r.status === 404) return `No ${what} found. Check the code with search.`;
  return `The hub answered: ${errText(r.body, r.status)}`;
}

// ── propose (writes nothing but the pending row) ────────────────────────────

type Proposal = { ok: true; code: string; body: Obj; summary: string; target: string; warnings: string[]; seen?: Obj } | { ok: false; text: string; status: number; target: string };

async function buildTicket(deps: ActionDeps, args: Obj): Promise<Proposal> {
  const system = one(args.system ?? args.system_code, 20).toUpperCase();
  const title = one(args.title, MAX_TITLE + 1);
  const description = s(args.description).trim();
  const priority = one(args.priority, 20).toLowerCase() || "medium";
  const type = one(args.type, 20).toLowerCase() || "bug";
  const reporter = one(args.reporterName ?? args.reporter_name, MAX_REPORTER + 1) || deps.userName;
  const target = `ticket:${system || "?"}`;
  const bad = (text: string): Proposal => ({ ok: false, text, status: 400, target });
  if (!/^[A-Z0-9]{1,20}$/.test(system)) return bad("Give the system code (e.g. HC, HK) the ticket is for.");
  if (!title) return bad("Give the ticket a title.");
  if (title.length > MAX_TITLE) return bad(`The title is longer than ${MAX_TITLE} characters.`);
  if (description.length > MAX_TEXT) return bad(`The description is longer than ${MAX_TEXT} characters.`);
  if (reporter.length > MAX_REPORTER) return bad(`The reporter name is longer than ${MAX_REPORTER} characters.`);
  if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) return bad("Priority is high, medium or low.");
  if (!(TICKET_TYPES as readonly string[]).includes(type)) return bad("Type is bug or development.");
  const sys = await deps.read("/api/v1/dev/systems");
  if (sys.status !== 200) return { ok: false, text: readRefusal(sys, "systems"), status: sys.status, target };
  const list = Array.isArray(obj(sys.body).systems) ? (obj(sys.body).systems as unknown[]).map(obj) : [];
  const hit = list.find((x) => s(x.code).toUpperCase() === system);
  if (!hit || Number(hit.active) !== 1) {
    const active = list.filter((x) => Number(x.active) === 1).map((x) => `${s(x.code)} (${s(x.name)})`);
    return bad(`No active system ${system}. Active systems: ${active.join(", ") || "none"}.`);
  }
  const body: Obj = { system_code: s(hit.code), title, description, type, priority, reporter_name: reporter };
  const summary = [
    `Create an IT ticket in ${s(hit.name)} (${s(hit.code)}), logged by ${deps.userName}:`,
    `Title: ${title}`,
    `Priority: ${priority}. Type: ${type}. Reporter: ${reporter}.`,
    description ? `Description: ${clip(description, 600)}` : "Description: (none)",
  ].join("\n");
  return { ok: true, code: "", body, summary, target, warnings: [] };
}

async function readTicket(deps: ActionDeps, code: string): Promise<{ ok: true; t: Obj } | { ok: false; text: string; status: number }> {
  const r = await deps.read(`/api/v1/dev/tickets/${encodeURIComponent(code)}`);
  if (r.status !== 200) return { ok: false, text: readRefusal(r, `ticket ${code}`), status: r.status };
  return { ok: true, t: obj(obj(r.body).ticket) };
}

async function buildComment(deps: ActionDeps, args: Obj): Promise<Proposal> {
  const code = one(args.code ?? args.id, 40).toUpperCase();
  const target = `ticket_comment:${code}`;
  const text = s(args.body ?? args.comment).trim();
  const vis = one(args.visibility, 20).toLowerCase() || "internal";
  const bad = (t: string): Proposal => ({ ok: false, text: t, status: 400, target });
  if (!CODE_RE.test(code)) return bad("Give a ticket code, e.g. HC-0042.");
  if (!text) return bad("Give the comment text.");
  if (text.length > MAX_TEXT) return bad(`The comment is longer than ${MAX_TEXT} characters.`);
  if (vis !== "public" && vis !== "internal") return bad("Visibility is internal (IT only, the default) or public (the reporter sees it).");
  const t = await readTicket(deps, code);
  if (!t.ok) return { ok: false, text: t.text, status: t.status, target };
  const warnings: string[] = [];
  if (vis === "public") warnings.push("Public: the reporter will see this comment in their system.");
  if (["closed", "rejected"].includes(s(t.t.status))) warnings.push(`This ticket is ${STATUS_LABEL[s(t.t.status)] ?? s(t.t.status)}.`);
  const summary = [
    `Add a ${vis === "public" ? "PUBLIC (the reporter sees it)" : "internal (IT only)"} comment to ${code} "${clip(s(t.t.title), 120)}", as ${deps.userName}:`,
    clip(text, 1500),
  ].join("\n");
  return { ok: true, code, body: { body: text, visibility: vis }, summary, target, warnings };
}

const STATUS_ALIASES: Record<string, string> = { close: "closed", done: "resolved", resolve: "resolved", reopen: "open", "in progress": "in_progress", "on hold": "on_hold", waiting: "waiting_reporter", reject: "rejected" };

/** "me" | "none" | a user id | a name → a user id (null = unassign), or an error. */
export function resolveAssignee(raw: unknown, users: Obj[], meId: number): { id: number | null; name: string } | { error: string } {
  const v = one(raw, 120);
  const low = v.toLowerCase();
  if (low === "me") {
    const me = users.find((u) => Number(u.id) === meId);
    return { id: meId, name: me ? s(me.name) : "me" };
  }
  if (low === "none" || low === "nobody" || low === "unassign" || low === "unassigned") return { id: null, name: "nobody" };
  if (/^\d{1,9}$/.test(v)) {
    const u = users.find((x) => Number(x.id) === Number(v));
    return u ? { id: Number(u.id), name: s(u.name) } : { error: `No active hub user with id ${v}.` };
  }
  const exact = users.filter((u) => s(u.name).toLowerCase() === low);
  const part = exact.length ? exact : users.filter((u) => s(u.name).toLowerCase().includes(low));
  if (part.length === 1) return { id: Number(part[0].id), name: s(part[0].name) };
  if (part.length === 0) return { error: `No active hub user matches "${v}".` };
  return { error: `"${v}" matches ${part.length} people: ${part.slice(0, 8).map((u) => `${s(u.name)} (id ${s(u.id)})`).join(", ")}. Give the id.` };
}

async function buildUpdate(deps: ActionDeps, args: Obj): Promise<Proposal> {
  const code = one(args.code ?? args.id, 40).toUpperCase();
  const target = `ticket_update:${code}`;
  const bad = (t: string): Proposal => ({ ok: false, text: t, status: 400, target });
  if (!CODE_RE.test(code)) return bad("Give a ticket code, e.g. HC-0042.");
  const rawStatus = one(args.status, 30).toLowerCase();
  const status = rawStatus ? (STATUS_ALIASES[rawStatus] ?? rawStatus.replace(/\s+/g, "_")) : "";
  const hasAssignee = args.assignee !== undefined && args.assignee !== null && s(args.assignee).trim() !== "";
  if (!status && !hasAssignee) return bad("Give a new status and / or an assignee (me, none, a name or a user id).");
  if (status && !(TICKET_STATUSES as readonly string[]).includes(status)) return bad(`Status is one of: ${TICKET_STATUSES.join(", ")}.`);
  const t = await readTicket(deps, code);
  if (!t.ok) return { ok: false, text: t.text, status: t.status, target };
  const cur = { status: s(t.t.status), assigneeId: t.t.assigneeId === null || t.t.assigneeId === undefined ? null : Number(t.t.assigneeId) };
  const body: Obj = {};
  const lines: string[] = [];
  let users: Obj[] = [];
  if (hasAssignee || cur.assigneeId !== null) {
    const u = await deps.read("/api/v1/dev/users");
    if (u.status !== 200) return { ok: false, text: readRefusal(u, "the user list"), status: u.status, target };
    users = Array.isArray(obj(u.body).users) ? (obj(u.body).users as unknown[]).map(obj) : [];
  }
  const nameOf = (id: number | null) => (id === null ? "nobody" : s(users.find((x) => Number(x.id) === id)?.name) || `user ${id}`);
  if (hasAssignee) {
    const a = resolveAssignee(args.assignee, users, deps.userId);
    if ("error" in a) return bad(a.error);
    if (a.id !== cur.assigneeId) {
      body.assignee_id = a.id;
      lines.push(`Assignee: ${nameOf(cur.assigneeId)} → ${a.name}`);
    }
  }
  if (status && status !== cur.status) {
    body.status = status;
    lines.push(`Status: ${STATUS_LABEL[cur.status] ?? cur.status} → ${STATUS_LABEL[status]}`);
  }
  if (!lines.length) return bad(`Nothing to change: ${code} already has that status and assignee.`);
  const warnings: string[] = [];
  if (body.status) warnings.push("Status changes are public: the reporter sees them.");
  const summary = [`Update ${code} "${clip(s(t.t.title), 120)}", as ${deps.userName}:`, ...lines].join("\n");
  return { ok: true, code, body, summary, target, warnings, seen: cur };
}

export type ProposeOutcome =
  | { ok: true; confirmationId: string; summary: string; warnings: string[]; target: string; expiresInMinutes: number }
  | { ok: false; text: string; status: number; target: string };

/** propose_ticket / propose_ticket_comment / propose_ticket_update: validates, stores ONE pending action, writes nothing else. */
export async function proposeAction(deps: ActionDeps, kind: WriteAction, args: Obj): Promise<ProposeOutcome> {
  const target0 = `${kind}:propose`;
  const sw = await deps.store.switches();
  if (!sw.main) return { ok: false, text: ACTIONS_OFF_MESSAGE, status: 403, target: target0 };
  if (!sw[kind]) return { ok: false, text: actionOffMessage(kind), status: 403, target: target0 };
  const p = kind === "ticket" ? await buildTicket(deps, args) : kind === "ticket_comment" ? await buildComment(deps, args) : await buildUpdate(deps, args);
  if (!p.ok) return p;
  if (!allowlistedAction(kind, p.code) || !actionBodyAllowed(kind, p.body)) return { ok: false, text: "Not possible through the AI connector (blocked by its write fence).", status: 400, target: p.target };
  const id = newActionId();
  const now = deps.now?.() ?? Date.now();
  await deps.store.create({
    id,
    tokenId: deps.tokenId,
    userId: deps.userId,
    kind,
    payload: { code: p.code, body: p.body, ...(p.seen ? { seen: p.seen } : {}) },
    summary: p.summary,
    expiresAt: new Date(now + ACTION_TTL_MS).toISOString(),
  });
  return { ok: true, confirmationId: id, summary: p.summary, warnings: p.warnings, target: p.target, expiresInMinutes: ACTION_TTL_MS / 60_000 };
}

// ── confirm / cancel ────────────────────────────────────────────────────────

/** The hub's reply to the write → what the person is told. */
export function describeWriteOutcome(kind: WriteAction, code: string, r: Reply, origin: string): { ok: boolean; text: string } {
  if (r.status >= 200 && r.status < 300) {
    if (kind === "ticket") {
      const c = s(obj(r.body).code);
      return { ok: true, text: `Done: ticket ${c} created. ${c ? ticketLink(origin, c) : ""}`.trim() };
    }
    return { ok: true, text: `Done: ${kind === "ticket_comment" ? "comment added to" : "updated"} ${code}. ${ticketLink(origin, code)}` };
  }
  if (r.status === 401 || r.status === 403) return { ok: false, text: `Not done — the hub refused: ${errText(r.body, r.status)}` };
  if (r.status === 404) return { ok: false, text: `Not done — ticket ${code} was not found.` };
  return { ok: false, text: `Not done — the hub answered: ${errText(r.body, r.status)}` };
}

export async function confirmAction(deps: ActionDeps, raw: unknown): Promise<Outcome> {
  const cid = s(raw).trim();
  let target = `confirm:${cid.slice(0, 40)}`;
  const fail = (text: string, status: number): Outcome => ({ ok: false, text, status, target });
  if (!ACTION_ID.test(cid)) return fail("Give the confirmationId from the propose_… tool.", 400);
  const now = deps.now?.() ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const sw = await deps.store.switches();
  if (!sw.main) return fail(ACTIONS_OFF_MESSAGE, 403);
  if ((await deps.store.confirmedSince(deps.userId, myDayStartIso(now))) >= ACTIONS_PER_DAY) {
    return fail(`You have reached today's limit of ${ACTIONS_PER_DAY} AI actions. Do it in the hub instead, or try again tomorrow.`, 429);
  }
  const peek = await deps.store.peekKind(cid, deps.tokenId, deps.userId, nowIso);
  if (peek && !sw[peek]) return fail(actionOffMessage(peek), 403);
  const act = await deps.store.claim(cid, deps.tokenId, deps.userId, nowIso);
  if (!act) return fail("That confirmation is unknown, already used, cancelled, expired (10 minutes) or not yours. Propose it again.", 404);
  if (!sw[act.kind]) {
    await deps.store.finish(cid, 403, "switched off");
    return fail(actionOffMessage(act.kind), 403);
  }
  const code = s(act.payload.code);
  const body = obj(act.payload.body);
  target = `${act.kind}:${code || s(body.system_code)}`;
  const route = allowlistedAction(act.kind, code);
  if (!route || !actionBodyAllowed(act.kind, body)) {
    await deps.store.finish(cid, 400, "blocked by the write fence");
    return { ok: false, text: "Not done — the request was blocked by the AI connector's write fence.", status: 400, target };
  }
  // Stale check: an update applies only to the ticket the person saw.
  if (act.kind === "ticket_update" && act.payload.seen) {
    const seen = obj(act.payload.seen);
    const t = await readTicket(deps, code);
    if (!t.ok) {
      await deps.store.finish(cid, t.status, "re-read refused");
      return { ok: false, text: `Not done — ${t.text}`, status: t.status, target };
    }
    const nowAssignee = t.t.assigneeId === null || t.t.assigneeId === undefined ? null : Number(t.t.assigneeId);
    if (s(t.t.status) !== s(seen.status) || nowAssignee !== (seen.assigneeId === null ? null : Number(seen.assigneeId))) {
      await deps.store.finish(cid, 409, "changed since proposal");
      return { ok: false, text: `Not done — ${code} was changed by someone since the summary was shown. Look at it again and propose the change again.`, status: 409, target };
    }
  }
  let out: Reply;
  try {
    out = await deps.write(cid, { method: route.method, path: route.path, body });
  } catch (e) {
    out = { status: 502, body: { error: e instanceof Error ? e.message : String(e) } };
  }
  const d = describeWriteOutcome(act.kind, code, out, deps.origin);
  await deps.store.finish(cid, out.status, d.ok ? "done" : clip(d.text, 200));
  if (act.kind === "ticket" && d.ok) target = `ticket:${s(obj(out.body).code) || s(body.system_code)}`;
  return { ok: d.ok, text: d.text, status: out.status, target };
}

export async function cancelAction(deps: ActionDeps, raw: unknown): Promise<Outcome> {
  const cid = s(raw).trim();
  const target = `cancel:${cid.slice(0, 40)}`;
  if (!ACTION_ID.test(cid)) return { ok: false, text: "Give the confirmationId from the propose_… tool.", status: 400, target };
  const done = await deps.store.cancel(cid, deps.tokenId, deps.userId, new Date(deps.now?.() ?? Date.now()).toISOString());
  return done
    ? { ok: true, text: "Cancelled. Nothing was changed.", status: 200, target }
    : { ok: false, text: "Nothing to cancel: that confirmation is unknown, already used or cancelled, or not yours.", status: 404, target };
}

// ── tool definitions (routes/mcp.ts lists them, filtered per person) ────────

const W = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const ASK =
  "Nothing is changed yet: it returns a summary and a confirmationId. Show this summary to the person word for word and ask them to confirm. Only call confirm_action after they explicitly say yes; otherwise call cancel_action.";

export const ACTION_TOOLS = [
  {
    name: "propose_ticket",
    title: "Prepare a new IT ticket",
    description: `Prepare a new IT ticket, logged by the signed-in person (like the hub's New ticket button). ${ASK}`,
    inputSchema: {
      type: "object",
      properties: {
        system: { type: "string", description: "System code the ticket is for, e.g. HC, HK" },
        title: { type: "string", description: `Short title, up to ${MAX_TITLE} characters` },
        description: { type: "string", description: "What happened / what is needed" },
        priority: { type: "string", enum: [...TICKET_PRIORITIES], description: "Default medium" },
        type: { type: "string", enum: [...TICKET_TYPES], description: "Default bug" },
        reporterName: { type: "string", description: "Who reported it. Default: the signed-in person" },
      },
      required: ["system", "title"],
      additionalProperties: false,
    },
    annotations: W,
  },
  {
    name: "propose_ticket_comment",
    title: "Prepare a ticket comment",
    description: `Prepare a comment on a ticket as the signed-in person. Internal (IT only) by default; public means the reporter sees it. ${ASK}`,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Ticket code, e.g. HC-0042" },
        body: { type: "string", description: "The comment text" },
        visibility: { type: "string", enum: ["internal", "public"], description: "Default internal" },
      },
      required: ["code", "body"],
      additionalProperties: false,
    },
    annotations: W,
  },
  {
    name: "propose_ticket_update",
    title: "Prepare an assignment or status change",
    description: `Prepare assigning a ticket and / or changing its status (including closing it), as the ticket page's Assignee picker and Status button do. Refused at confirm if the ticket changed in between. ${ASK}`,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Ticket code, e.g. HC-0042" },
        status: { type: "string", enum: [...TICKET_STATUSES], description: "New status (closed = close it)" },
        assignee: { type: "string", description: "me, none (unassign), a person's name or a hub user id" },
      },
      required: ["code"],
      additionalProperties: false,
    },
    annotations: W,
  },
  {
    name: "confirm_action",
    title: "Confirm a prepared action",
    description: "Carry out an action prepared by a propose_… tool, ONLY after the person saw its summary and explicitly said yes. Single use, valid 10 minutes.",
    inputSchema: { type: "object", properties: { confirmationId: { type: "string" } }, required: ["confirmationId"], additionalProperties: false },
    annotations: W,
  },
  {
    name: "cancel_action",
    title: "Cancel a prepared action",
    description: "Drop an action prepared by a propose_… tool (the person said no or wants changes). Nothing is changed.",
    inputSchema: { type: "object", properties: { confirmationId: { type: "string" } }, required: ["confirmationId"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];
