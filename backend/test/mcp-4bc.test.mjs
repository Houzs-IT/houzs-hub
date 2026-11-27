// AI Connector rounds 4b (write actions) + 4c (platform quality):
// services/mcp-write-actions.ts and services/mcp-visibility.ts, with an in-memory
// store and a faked hub that applies the ticket routes' own gate (need("it")) and
// validation. Run: npm --prefix backend test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTION_ALLOWLIST,
  ACTION_PERMISSION,
  ACTIONS_PER_DAY,
  actionBodyAllowed,
  allowlistedAction,
  armConfirmedAction,
  cancelAction,
  confirmAction,
  isAllowlisted,
  myDayStartIso,
  proposeAction,
  resolveAssignee,
  takeConfirmedAction,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  TOOL_ACTION,
  WRITE_ACTIONS,
} from "../src/services/mcp-write-actions.ts";
import {
  AnswerCache,
  PROMPT_TOOLS,
  ROLE_PROMPTS,
  rolePromptText,
  TOOL_NEEDS,
  toolAllowed,
  withHubLinks,
} from "../src/services/mcp-visibility.ts";

const O = "https://support.example";
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const NOW = Date.parse("2026-11-27T02:00:00Z"); // 10:00 Malaysia

// ── fakes ───────────────────────────────────────────────────────────────────

function memStore(on = {}) {
  const rows = new Map();
  const sw = { main: false, ticket: false, ticket_comment: false, ticket_update: false, ...on };
  return {
    rows,
    sw,
    async switches() {
      return { ...sw };
    },
    async confirmedSince(userId, sinceIso) {
      return [...rows.values()].filter((r) => r.userId === userId && r.usedAt && r.usedAt >= sinceIso).length;
    },
    async create(a) {
      rows.set(a.id, { ...a, payload: structuredClone(a.payload), usedAt: null, cancelledAt: null });
    },
    async peekKind(id, tokenId, userId, nowIso) {
      const r = rows.get(id);
      return r && r.tokenId === tokenId && r.userId === userId && !r.usedAt && !r.cancelledAt && r.expiresAt > nowIso ? r.kind : null;
    },
    async claim(id, tokenId, userId, nowIso) {
      const r = rows.get(id);
      if (!r || r.tokenId !== tokenId || r.userId !== userId || r.usedAt || r.cancelledAt || r.expiresAt <= nowIso) return null;
      r.usedAt = nowIso;
      return { kind: r.kind, payload: r.payload, summary: r.summary };
    },
    async finish(id, status, note) {
      const r = rows.get(id);
      if (r) Object.assign(r, { status, note, payload: {} });
    },
    async cancel(id, tokenId, userId, nowIso) {
      const r = rows.get(id);
      if (!r || r.tokenId !== tokenId || r.userId !== userId || r.usedAt || r.cancelledAt) return false;
      r.cancelledAt = nowIso;
      return true;
    },
  };
}

/** The hub as the routes behave: GETs and the three write routes, each behind need("it"). */
function fakeHub(perms = ["it"]) {
  const hub = {
    perms,
    writes: [],
    tickets: new Map([["HC-0042", { code: "HC-0042", title: "Printer offline", status: "open", assigneeId: null }]]),
    systems: [
      { code: "HC", name: "Houzs Century", active: 1 },
      { code: "OLD", name: "Retired", active: 0 },
    ],
    users: [
      { id: 7, name: "Alice Tan" },
      { id: 9, name: "Ben Lim" },
      { id: 11, name: "Ben Ong" },
    ],
  };
  const deny = { status: 403, body: { error: "You do not have permission for this" } };
  hub.read = async (path) => {
    if (path === "/api/v1/dev/systems") return { status: 200, body: { systems: hub.systems } };
    if (path === "/api/v1/dev/users") return { status: 200, body: { users: hub.users } };
    if (!hub.perms.includes("it")) return { status: 403, body: { error: "Not available to your role" } };
    const m = path.match(/^\/api\/v1\/dev\/tickets\/([^/]+)$/);
    if (m) {
      const t = hub.tickets.get(decodeURIComponent(m[1]));
      return t ? { status: 200, body: { ticket: { ...t } } } : { status: 404, body: { error: "Not found" } };
    }
    return { status: 404, body: { error: "Not found" } };
  };
  hub.write = async (actionId, req) => {
    // devAuth: the armed action passes once. Then the route's own need("it").
    if (!takeConfirmedAction(actionId, "tok1", req.method, req.path)) return { status: 403, body: { error: "The AI Connector is read-only" } };
    if (!hub.perms.includes("it")) return deny;
    hub.writes.push(req);
    if (req.method === "POST" && req.path === "/api/v1/dev/tickets") {
      const code = "HC-0043";
      hub.tickets.set(code, { code, title: req.body.title, status: "open", assigneeId: null });
      return { status: 201, body: { code } };
    }
    const code = req.path.split("/")[5];
    const t = hub.tickets.get(code);
    if (!t) return { status: 404, body: { error: "Not found" } };
    if (req.method === "PATCH") {
      if (req.body.status) t.status = req.body.status;
      if (req.body.assignee_id !== undefined) t.assigneeId = req.body.assignee_id;
      return { status: 200, body: { ok: true } };
    }
    return { status: 201, body: { ok: true, event_id: 1 } };
  };
  return hub;
}

const deps = (store, hub, over = {}) => ({
  store,
  tokenId: "tok1",
  userId: 7,
  userName: "Alice Tan",
  origin: O,
  read: hub.read,
  // Mirrors routes/mcp.ts innerAction: arm, then the in-process call.
  write: (id, req) => {
    armConfirmedAction(id, "tok1", req.method, req.path);
    return hub.write(id, req);
  },
  now: () => NOW,
  ...over,
});

const ALL_ON = { main: true, ticket: true, ticket_comment: true, ticket_update: true };

// ── 4b: a proposal writes nothing ───────────────────────────────────────────

test("propose: stores one pending action and writes nothing to the hub", async () => {
  for (const [kind, args] of [
    ["ticket", { system: "hc", title: "VPN down", description: "Since 9 am", priority: "high" }],
    ["ticket_comment", { code: "HC-0042", body: "Checking the cable" }],
    ["ticket_update", { code: "HC-0042", status: "closed", assignee: "me" }],
  ]) {
    const store = memStore(ALL_ON);
    const hub = fakeHub();
    const o = await proposeAction(deps(store, hub), kind, args);
    assert.equal(o.ok, true, JSON.stringify(o));
    assert.match(o.confirmationId, /^mcpa_[a-f0-9]{24}$/);
    assert.equal(hub.writes.length, 0, `${kind}: nothing written`);
    assert.equal(store.rows.size, 1);
    assert.equal(hub.tickets.get("HC-0042").status, "open");
  }
});

test("propose: summaries say what will happen; defaults and validation", async () => {
  const store = memStore(ALL_ON);
  const hub = fakeHub();
  const t = await proposeAction(deps(store, hub), "ticket", { system: "HC", title: "VPN down" });
  assert.match(t.summary, /Houzs Century \(HC\)/);
  assert.match(t.summary, /Priority: medium\. Type: bug\. Reporter: Alice Tan/);
  const c = await proposeAction(deps(store, hub), "ticket_comment", { code: "hc-0042", body: "Hi" });
  assert.match(c.summary, /internal \(IT only\)/); // internal by default
  const pub = await proposeAction(deps(store, hub), "ticket_comment", { code: "HC-0042", body: "Hi", visibility: "public" });
  assert.match(pub.warnings.join(" "), /reporter will see/);
  const u = await proposeAction(deps(store, hub), "ticket_update", { code: "HC-0042", status: "close", assignee: "Alice" });
  assert.match(u.summary, /Assignee: nobody → Alice Tan/);
  assert.match(u.summary, /Status: Open → Closed/);

  const bad = async (kind, args, re) => {
    const o = await proposeAction(deps(store, hub), kind, args);
    assert.equal(o.ok, false, JSON.stringify(args));
    assert.match(o.text, re);
  };
  await bad("ticket", { system: "OLD", title: "x" }, /No active system OLD/);
  await bad("ticket", { system: "HC", title: "" }, /title/);
  await bad("ticket", { system: "HC", title: "x", priority: "urgent!" }, /Priority/);
  await bad("ticket_comment", { code: "HC-9999", body: "x" }, /No ticket HC-9999/);
  await bad("ticket_comment", { code: "HC-0042", body: "   " }, /comment text/);
  await bad("ticket_update", { code: "HC-0042" }, /status and \/ or an assignee/);
  await bad("ticket_update", { code: "HC-0042", status: "open" }, /Nothing to change/);
  await bad("ticket_update", { code: "HC-0042", assignee: "Ben" }, /matches 2 people/);
  await bad("ticket_update", { code: "HC-0042", status: "deleted" }, /Status is one of/);
});

// ── 4b: confirm writes exactly once ─────────────────────────────────────────

test("confirm: ONE write through the hub's own route; a second confirm does nothing", async () => {
  const store = memStore(ALL_ON);
  const hub = fakeHub();
  const p = await proposeAction(deps(store, hub), "ticket_update", { code: "HC-0042", status: "in_progress", assignee: "me" });
  const c1 = await confirmAction(deps(store, hub), p.confirmationId);
  assert.equal(c1.ok, true, c1.text);
  assert.match(c1.text, /Done: updated HC-0042\. https:\/\/support\.example\/tickets\/HC-0042/);
  assert.deepEqual(hub.writes, [{ method: "PATCH", path: "/api/v1/dev/tickets/HC-0042", body: { assignee_id: 7, status: "in_progress" } }]);
  assert.equal(c1.target, "ticket_update:HC-0042");
  const c2 = await confirmAction(deps(store, hub), p.confirmationId);
  assert.equal(c2.ok, false);
  assert.equal(c2.status, 404);
  assert.equal(hub.writes.length, 1, "single use");
});

test("confirm: create and comment hit POST routes with only the screen's fields", async () => {
  const store = memStore(ALL_ON);
  const hub = fakeHub();
  const p = await proposeAction(deps(store, hub), "ticket", { system: "HC", title: "VPN down", description: "since 9", priority: "high", type: "bug" });
  const c = await confirmAction(deps(store, hub), p.confirmationId);
  assert.match(c.text, /ticket HC-0043 created/);
  assert.equal(c.target, "ticket:HC-0043");
  const q = await proposeAction(deps(store, hub), "ticket_comment", { code: "HC-0042", body: "On it" });
  await confirmAction(deps(store, hub), q.confirmationId);
  assert.deepEqual(hub.writes, [
    { method: "POST", path: "/api/v1/dev/tickets", body: { system_code: "HC", title: "VPN down", description: "since 9", type: "bug", priority: "high", reporter_name: "Alice Tan" } },
    { method: "POST", path: "/api/v1/dev/tickets/HC-0042/comments", body: { body: "On it", visibility: "internal" } },
  ]);
  // The payload (comment / description text) is dropped once the action ran.
  for (const r of store.rows.values()) assert.deepEqual(r.payload, {});
});

test("confirm: another token or person, expiry, cancel", async () => {
  const store = memStore(ALL_ON);
  const hub = fakeHub();
  const p = await proposeAction(deps(store, hub), "ticket_comment", { code: "HC-0042", body: "x" });
  assert.equal((await confirmAction(deps(store, hub, { tokenId: "tok2" }), p.confirmationId)).status, 404);
  assert.equal((await confirmAction(deps(store, hub, { userId: 9 }), p.confirmationId)).status, 404);
  assert.equal((await confirmAction(deps(store, hub, { now: () => NOW + 11 * 60_000 }), p.confirmationId)).status, 404);
  assert.equal((await cancelAction(deps(store, hub), p.confirmationId)).ok, true);
  assert.equal((await confirmAction(deps(store, hub), p.confirmationId)).status, 404);
  assert.equal((await cancelAction(deps(store, hub), p.confirmationId)).ok, false);
  assert.equal((await confirmAction(deps(store, hub), "nonsense")).status, 400);
  assert.equal(hub.writes.length, 0);
});

test("confirm: an update is refused if the ticket changed since the summary", async () => {
  const store = memStore(ALL_ON);
  const hub = fakeHub();
  const p = await proposeAction(deps(store, hub), "ticket_update", { code: "HC-0042", status: "closed" });
  hub.tickets.get("HC-0042").assigneeId = 9; // a colleague picked it up
  const c = await confirmAction(deps(store, hub), p.confirmationId);
  assert.equal(c.status, 409);
  assert.match(c.text, /changed by someone/);
  assert.equal(hub.writes.length, 0);
});

test("confirm: daily cap", async () => {
  const store = memStore(ALL_ON);
  const hub = fakeHub();
  for (let i = 0; i < ACTIONS_PER_DAY; i++) store.rows.set(`x${i}`, { userId: 7, usedAt: new Date(NOW - 60_000).toISOString() });
  store.rows.set("yesterday", { userId: 7, usedAt: new Date(NOW - 11 * 3600_000).toISOString() }); // 23:00 MYT the day before
  const p = await proposeAction(deps(store, hub), "ticket_comment", { code: "HC-0042", body: "x" });
  const c = await confirmAction(deps(store, hub), p.confirmationId);
  assert.equal(c.status, 429);
  assert.match(c.text, new RegExp(`limit of ${ACTIONS_PER_DAY}`));
  assert.equal(hub.writes.length, 0);
  assert.equal(myDayStartIso(NOW), "2026-11-26T16:00:00.000Z");
});

// ── 4b: a switched-off action is refused ────────────────────────────────────

test("switches: main off or the action's own switch off refuses propose and confirm", async () => {
  const hub = fakeHub();
  assert.match((await proposeAction(deps(memStore({ ...ALL_ON, main: false }), hub), "ticket", { system: "HC", title: "x" })).text, /AI actions are switched off/);
  assert.match((await proposeAction(deps(memStore({ ...ALL_ON, ticket: false }), hub), "ticket", { system: "HC", title: "x" })).text, /"Create IT tickets" is switched off/);

  // Switched off between propose and confirm: refused, and the id is NOT used up.
  const store = memStore(ALL_ON);
  const p = await proposeAction(deps(store, hub), "ticket_update", { code: "HC-0042", status: "closed" });
  store.sw.ticket_update = false;
  const c = await confirmAction(deps(store, hub), p.confirmationId);
  assert.equal(c.status, 403);
  assert.match(c.text, /switched off/);
  store.sw.ticket_update = true;
  assert.equal((await confirmAction(deps(store, hub), p.confirmationId)).ok, true);
  store.sw.main = false;
  const p2 = { confirmationId: "mcpa_" + "a".repeat(24) };
  assert.match((await confirmAction(deps(store, hub), p2.confirmationId)).text, /AI actions are switched off/);
  assert.equal(hub.writes.length, 1);
});

test("switches: every action defaults OFF (no settings row = off)", async () => {
  const s = await memStore().switches();
  assert.deepEqual(s, { main: false, ticket: false, ticket_comment: false, ticket_update: false });
  const real = src("../src/services/mcp-write-actions.ts");
  assert.match(real, /const off = \{ main: false, ticket: false, ticket_comment: false, ticket_update: false \}/);
  assert.match(src("../src/db/migrations/025_mcp_write_actions.sql"), /enabled integer NOT NULL DEFAULT 0/);
});

// ── 4b: a person without permission gets the hub's own refusal ──────────────

test("permission: without IT tickets the hub refuses the read at propose and the write at confirm", async () => {
  const store = memStore(ALL_ON);
  const noIt = fakeHub([]);
  const p = await proposeAction(deps(store, noIt), "ticket_comment", { code: "HC-0042", body: "x" });
  assert.equal(p.ok, false);
  assert.equal(p.status, 403);
  assert.match(p.text, /do not have permission for ticket HC-0042/);

  // Permission removed between propose and confirm: the route's need("it") answers.
  const hub = fakeHub(["it"]);
  const q = await proposeAction(deps(store, hub), "ticket", { system: "HC", title: "x" });
  hub.perms = [];
  const c = await confirmAction(deps(store, hub), q.confirmationId);
  assert.equal(c.ok, false);
  assert.equal(c.status, 403);
  assert.equal(c.text, "Not done — the hub refused: You do not have permission for this");
  assert.equal(hub.writes.length, 0);
});

// ── the fence ───────────────────────────────────────────────────────────────

test("fence: only the three ticket routes, and only the screen's fields", () => {
  assert.deepEqual(ACTION_ALLOWLIST.map((a) => `${a.method} ${a.path}`), ["POST /api/v1/dev/tickets", "POST /api/v1/dev/tickets/:code/comments", "PATCH /api/v1/dev/tickets/:code"]);
  assert.equal(isAllowlisted("PATCH", "/api/v1/dev/tickets/HC-0042"), true);
  for (const [m, p] of [
    ["DELETE", "/api/v1/dev/tickets/HC-0042"],
    ["DELETE", "/api/v1/dev/tickets/HC-0042/comments/5"],
    ["POST", "/api/v1/dev/tickets/HC-0042/pickup"],
    ["POST", "/api/v1/dev/tickets/reorder"],
    ["PATCH", "/api/v1/dev/tickets/HC-0042/comments/5"],
    ["POST", "/api/v1/dev/billing/charges"],
    ["PATCH", "/api/v1/dev/accounts/1"],
    ["POST", "/api/v1/dev/admin/users"],
    ["PATCH", "/api/v1/dev/tickets/../admin/users/1"],
  ]) assert.equal(isAllowlisted(m, p), false, `${m} ${p}`);
  assert.equal(allowlistedAction("ticket_update", "HC-0042/../x"), null);
  assert.equal(allowlistedAction("delete_ticket", "HC-0042"), null);

  assert.equal(actionBodyAllowed("ticket_update", { status: "closed" }), true);
  assert.equal(actionBodyAllowed("ticket_update", { assignee_id: null }), true);
  assert.equal(actionBodyAllowed("ticket_update", { priority: "high" }), false); // not this action's field
  assert.equal(actionBodyAllowed("ticket_update", { module: "x", status: "open" }), false);
  assert.equal(actionBodyAllowed("ticket_update", { status: "gone" }), false);
  assert.equal(actionBodyAllowed("ticket_update", { assignee_id: "7" }), false);
  assert.equal(actionBodyAllowed("ticket_update", {}), false);
  assert.equal(actionBodyAllowed("ticket_comment", { body: "x", visibility: "internal" }), true);
  assert.equal(actionBodyAllowed("ticket_comment", { body: "x", visibility: "internal", status: "closed" }), false);
  assert.equal(actionBodyAllowed("ticket", { system_code: "HC", title: "t", reporter_name: "A" }), true);
  assert.equal(actionBodyAllowed("ticket", { system_code: "HC", title: "t", reporter_name: "A", reporter_external_id: "x" }), false);
  assert.equal(actionBodyAllowed("ticket", ["x"]), false);
});

test("fence: an armed write passes once, for its own token + method + path only", () => {
  armConfirmedAction("mcpa_1", "tokA", "PATCH", "/api/v1/dev/tickets/HC-1");
  assert.equal(takeConfirmedAction("mcpa_1", "tokB", "PATCH", "/api/v1/dev/tickets/HC-1"), false); // wrong token, and the arm is gone
  assert.equal(takeConfirmedAction("mcpa_1", "tokA", "PATCH", "/api/v1/dev/tickets/HC-1"), false);
  armConfirmedAction("mcpa_2", "tokA", "PATCH", "/api/v1/dev/tickets/HC-1");
  assert.equal(takeConfirmedAction("mcpa_2", "tokA", "DELETE", "/api/v1/dev/tickets/HC-1"), false);
  armConfirmedAction("mcpa_3", "tokA", "PATCH", "/api/v1/dev/tickets/HC-1");
  assert.equal(takeConfirmedAction("mcpa_3", "tokA", "PATCH", "/api/v1/dev/tickets/HC-1"), true);
  assert.equal(takeConfirmedAction("mcpa_3", "tokA", "PATCH", "/api/v1/dev/tickets/HC-1"), false); // one-shot
  armConfirmedAction("mcpa_4", "tokA", "DELETE", "/api/v1/dev/tickets/HC-1"); // not allowlisted: never armed
  assert.equal(takeConfirmedAction("mcpa_4", "tokA", "DELETE", "/api/v1/dev/tickets/HC-1"), false);
  assert.equal(takeConfirmedAction(undefined, "tokA", "PATCH", "/api/v1/dev/tickets/HC-1"), false);
});

test("fence: devAuth lets an hbmcp_ token write only through takeConfirmedAction", () => {
  const auth = src("../src/middleware/devAuth.ts");
  assert.match(auth, /if \(isWrite && !actionId\) return c\.json\(\{ error: "The AI Connector is read-only" \}, 403\)/);
  assert.match(auth, /if \(isWrite && !takeConfirmedAction\(actionId, tokenId, c\.req\.method, c\.req\.path\)\)/);
  const mcp = src("../src/routes/mcp.ts");
  assert.equal((mcp.match(/armConfirmedAction\(/g) ?? []).length, 1, "armed in exactly one place (innerAction)");
});

test("status / priority / type lists match db/schema.ts", () => {
  const schema = src("../src/db/schema.ts");
  const list = (name) => JSON.parse(`[${schema.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))[1].replace(/\s+/g, " ").replace(/,\s*$/, "")}]`);
  assert.deepEqual(list("TICKET_STATUSES"), [...TICKET_STATUSES]);
  assert.deepEqual(list("TICKET_PRIORITIES"), [...TICKET_PRIORITIES]);
  assert.deepEqual(list("TICKET_TYPES"), [...TICKET_TYPES]);
});

test("resolveAssignee: me, none, id, unique name", () => {
  const users = [{ id: 7, name: "Alice Tan" }, { id: 9, name: "Ben Lim" }];
  assert.deepEqual(resolveAssignee("me", users, 7), { id: 7, name: "Alice Tan" });
  assert.deepEqual(resolveAssignee("none", users, 7), { id: null, name: "nobody" });
  assert.deepEqual(resolveAssignee("9", users, 7), { id: 9, name: "Ben Lim" });
  assert.deepEqual(resolveAssignee("ben", users, 7), { id: 9, name: "Ben Lim" });
  assert.match(resolveAssignee("42", users, 7).error, /No active hub user/);
});

// ── 4c P1: role-aware tools/list ────────────────────────────────────────────

const WRITE_META = { toolAction: TOOL_ACTION, permission: ACTION_PERMISSION, actions: WRITE_ACTIONS };
const listFor = (perms, sw = { main: false }) => Object.keys({ ...TOOL_NEEDS, ...Object.fromEntries(Object.keys(TOOL_ACTION).map((k) => [k, 1])), confirm_action: 1, cancel_action: 1 }).filter((n) => toolAllowed(n, perms, sw, WRITE_META));

test("P1: tools follow the hub permissions; write tools only while switched on", () => {
  const staff = listFor([]);
  // Round 5 help tools read no hub data, so every staff member has them too.
  const HELP = ["explain_error", "explain_screen", "glossary", "how_to", "module_overview", "onboarding", "show_me", "where_is"];
  assert.deepEqual(staff.sort(), ["daily_brief", "erp_get", ...HELP, "list_endpoints", "list_modules", "meetings_today", "whoami"].sort());
  const it = listFor(["it"]);
  for (const n of ["ticket_summary", "tickets_today", "search", "fetch", "export_excel", "data_gaps"]) assert.ok(it.includes(n), n);
  assert.ok(!it.includes("health_summary"));
  assert.ok(listFor(["health_view"]).includes("health_summary"));
  assert.ok(listFor(["billing_view"]).includes("data_gaps"));
  for (const n of ["propose_ticket", "confirm_action", "cancel_action"]) assert.ok(!it.includes(n), `${n} hidden while off`);

  const on = listFor(["it"], { main: true, ticket: true, ticket_comment: false, ticket_update: false });
  assert.ok(on.includes("propose_ticket") && on.includes("confirm_action") && on.includes("cancel_action"));
  assert.ok(!on.includes("propose_ticket_comment") && !on.includes("propose_ticket_update"));
  assert.ok(!listFor(["it"], { main: false, ticket: true }).includes("propose_ticket"), "main switch gates all");
  assert.ok(!listFor([], ALL_ON).includes("propose_ticket"), "no IT tickets permission: hidden even when on");
  assert.ok(!listFor([], ALL_ON).includes("confirm_action"));
});

test("P1: every listed tool in routes/mcp.ts has a visibility rule", () => {
  const mcp = src("../src/routes/mcp.ts") + src("../src/services/mcp-round4.ts");
  const names = [...mcp.matchAll(/\bname: "([a-z_]+)",\s*\n?\s*title:/g)].map((m) => m[1]);
  assert.ok(names.length >= 15, String(names.length));
  for (const n of names) assert.ok(n in TOOL_NEEDS || n in TOOL_ACTION || n === "confirm_action" || n === "cancel_action", `no rule for ${n}`);
  assert.match(src("../src/routes/mcp.ts"), /You do not have access to this in the hub/);
});

// ── 4c P2: prompts per role ─────────────────────────────────────────────────

test("P2: role prompts exist, use listed tools, and render", () => {
  assert.deepEqual(ROLE_PROMPTS.map((p) => p.name), ["it_morning_triage", "my_tickets_review", "it_manager_weekly"]);
  for (const p of ROLE_PROMPTS) {
    assert.ok(PROMPT_TOOLS[p.name]?.length, p.name);
    const t = rolePromptText(p.name, { system: "hc" });
    for (const tool of PROMPT_TOOLS[p.name].filter((x) => x !== "daily_brief")) assert.ok(t.includes(tool), `${p.name} mentions ${tool}`);
  }
  assert.match(rolePromptText("it_morning_triage", { system: "hc;drop" }), /system HCDROP/);
  assert.equal(rolePromptText("nope", {}), null);
  // A staff member without IT tickets sees no IT prompt (first tool hidden).
  const ok = (n) => toolAllowed(n, [], { main: false }, WRITE_META);
  // ...only the daily brief and the round 5 help prompts (help reads no hub data).
  assert.deepEqual(Object.keys(PROMPT_TOOLS).filter((p) => ok(PROMPT_TOOLS[p][0])), ["daily-brief", "how_do_i", "explain_this_error", "my_first_week"]);
});

// ── 4c P3 / P5: structured output + links ───────────────────────────────────

test("P3/P5: hub link on the answer and a url on every ticket row", () => {
  const v = withHubLinks("tickets_overdue", { overdue: [{ code: "HC-1", title: "a" }, { code: "HK-2", url: "x" }], bySystem: { HC: 1 } }, O);
  assert.equal(v.hubLink, `${O}/reports`);
  assert.equal(v.overdue[0].url, `${O}/tickets/HC-1`);
  assert.equal(v.overdue[1].url, "x"); // an existing link is kept
  assert.deepEqual(v.bySystem, { HC: 1 });
  assert.equal(withHubLinks("health_summary", {}, O).hubLink, `${O}/health`);
  const mcp = src("../src/routes/mcp.ts");
  assert.match(mcp, /outputSchema: QUICK_OUTPUT_SCHEMA/);
  assert.match(mcp, /structuredContent: value/);
});

// ── 4c P4: cache ────────────────────────────────────────────────────────────

test("P4: 60 s per person + permissions + arguments; dropped after a write", () => {
  const c = new AnswerCache(60_000, 3);
  const k = AnswerCache.key(7, ["it"], "ticket_summary", { b: 1, a: 2 });
  assert.equal(k, AnswerCache.key(7, ["it"], "ticket_summary", { a: 2, b: 1 }), "argument order does not matter");
  assert.notEqual(k, AnswerCache.key(9, ["it"], "ticket_summary", { a: 2, b: 1 }), "per person");
  assert.notEqual(k, AnswerCache.key(7, ["it", "billing_view"], "ticket_summary", { a: 2, b: 1 }), "per permissions");
  c.set(k, "A", 0);
  assert.equal(c.get(k, 59_999), "A");
  assert.equal(c.get(k, 60_000), null);
  c.set(k, "A", 0);
  c.dropUser(7);
  assert.equal(c.get(k, 1), null);
  for (let i = 0; i < 5; i++) c.set(`9|x|${i}`, i, 0);
  assert.ok(c.get("9|x|4", 1) === 4);
});
