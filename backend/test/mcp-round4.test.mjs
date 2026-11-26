// AI Connector round 4 (src/services/mcp-round4.ts): tickets_overdue, ticket_digest,
// data_gaps, the period convention, and the permission tests (a role without access
// gets "no access" and no data). Run: npm --prefix backend test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addMonths,
  buildDataGaps,
  periodWindow,
  ROUND4_ENDPOINTS,
  ROUND4_TOOLS,
  runRound4Tool,
  SLA_HOURS,
  summariseDigest,
  summariseOverdue,
  trimText,
} from "../src/services/mcp-round4.ts";
import { ticketDocument } from "../src/services/mcp-quick.ts";

const NOW = Date.parse("2026-11-26T04:00:00Z"); // Thursday 12:00 in Malaysia
const O = "https://support.example";
const H = 3_600_000;
const ago = (hours) => new Date(NOW - hours * H).toISOString();
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// ── period ──────────────────────────────────────────────────────────────────

test("period: each name gives its window and the previous one", () => {
  const w = (p, f, t, today = "2026-11-26") => {
    const r = periodWindow(p, f, t, today);
    assert.ok(!("error" in r), JSON.stringify(r));
    return [r.period, r.current.from, r.current.to, r.previous.from, r.previous.to];
  };
  assert.deepEqual(w("today"), ["today", "2026-11-26", "2026-11-26", "2026-11-25", "2026-11-25"]);
  assert.deepEqual(w("week"), ["week", "2026-11-23", "2026-11-26", "2026-11-16", "2026-11-19"]); // Monday start
  assert.deepEqual(w("week", "", "", "2026-11-23"), ["week", "2026-11-23", "2026-11-23", "2026-11-16", "2026-11-16"]);
  assert.deepEqual(w("month"), ["month", "2026-11-01", "2026-11-26", "2026-10-01", "2026-10-26"]);
  assert.deepEqual(w("last_month"), ["last_month", "2026-10-01", "2026-10-31", "2026-09-01", "2026-09-30"]);
  assert.deepEqual(w("last_month", "", "", "2026-01-15"), ["last_month", "2025-12-01", "2025-12-31", "2025-11-01", "2025-11-30"]);
  assert.deepEqual(w("quarter"), ["quarter", "2026-10-01", "2026-11-26", "2026-07-01", "2026-08-26"]);
  assert.deepEqual(w("year"), ["year", "2026-01-01", "2026-11-26", "2025-01-01", "2025-11-26"]);
  assert.deepEqual(w("custom", "2026-11-01", "2026-11-10"), ["custom", "2026-11-01", "2026-11-10", "2026-10-22", "2026-10-31"]);
  assert.deepEqual(w("", "2026-11-01", "2026-11-10")[0], "custom"); // from / to alone mean custom
  assert.deepEqual(w("Last Month")[0], "last_month");
  assert.equal(periodWindow(undefined, "", "", "2026-11-26", "week").period, "week"); // the tool's default
});

test("period: Malaysia-day instants, month-end clamp, refusals", () => {
  const r = periodWindow("today", "", "", "2026-11-26");
  assert.equal(r.current.start, "2026-11-25T16:00:00.000Z");
  assert.equal(r.current.end, "2026-11-26T16:00:00.000Z");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonths("2024-03-31", -1), "2024-02-29");
  assert.equal(periodWindow("month", "", "", "2026-03-31").previous.to, "2026-02-28");
  assert.match(periodWindow("fortnight", "", "", "2026-11-26").error, /Unknown period/);
  assert.match(periodWindow("custom", "2026-11-01", "", "2026-11-26").error, /from and to/);
  assert.match(periodWindow("custom", "2026-11-10", "2026-11-01", "2026-11-26").error, /on or before/);
  assert.match(periodWindow("custom", "2024-01-01", "2026-11-01", "2026-11-26").error, /at most 366/);
});

// ── tickets_overdue ─────────────────────────────────────────────────────────

const REPORT = {
  open_tickets: [
    // high, 30 h old, 10 h waiting on reporter -> 20 h used: within 24 h
    { code: "HC-1", title: "Waited", sys: "HC", priority: "high", status: "in_progress", created_at: ago(30), waiting_hours: 10, assignee_id: 3, assignee: "Ann", module: "POS" },
    // high, 30 h old, never waiting -> past SLA by 6 h, unassigned
    { code: "HC-2", title: "Down", sys: "HC", priority: "high", status: "open", created_at: ago(30), waiting_hours: 0, assignee_id: null, assignee: null },
    // medium, 100 h -> past 72 h by 28 h
    { code: "HK-3", title: "Slow", sys: "HK", priority: "medium", status: "open", created_at: ago(100), waiting_hours: 0, assignee_id: 4, assignee: "Ben", module: "" },
    // low, imported from the sheet: never counts
    { code: "HK-4", title: "Old", sys: "HK", priority: "low", status: "open", created_at: ago(5000), waiting_hours: 0, legacy: true, assignee_id: null },
    // high, 2 h old, unassigned: urgent but within SLA
    { code: "CONTS-5", title: "New", sys: "CONTS", priority: "high", status: "open", created_at: ago(2), waiting_hours: 0, assignee_id: null },
  ],
};

test("tickets_overdue: the Reports page's past-SLA rule and urgent unassigned", () => {
  const r = summariseOverdue(REPORT, { systems: [], origin: O }, NOW);
  assert.equal(r.openTickets, 5);
  assert.equal(r.pastSla.total, 2);
  assert.deepEqual(r.pastSla.tickets.map((t) => [t.code, t.hoursOver]), [["HK-3", 28], ["HC-2", 6]]); // most overdue first
  assert.deepEqual(r.pastSla.bySystem, { HC: 1, HK: 1 });
  assert.deepEqual(r.pastSla.byAssignee, { Unassigned: 1, Ben: 1 });
  assert.deepEqual(r.urgentUnassigned.tickets.map((t) => t.code), ["HC-2", "CONTS-5"]);
  assert.deepEqual(r.urgentUnassigned.bySystem, { HC: 1, CONTS: 1 });
  assert.equal(r.pastSla.tickets[0].url, `${O}/tickets/HK-3`);
  const hc = summariseOverdue(REPORT, { systems: ["HC"], origin: O }, NOW);
  assert.equal(hc.pastSla.total, 1);
  assert.equal(hc.urgentUnassigned.total, 1);
});

test("tickets_overdue: SLA targets match the Reports page (frontend/src/lib/labels.ts)", () => {
  const m = src("../../frontend/src/lib/labels.ts").match(/SLA_HOURS[^=]*=\s*\{([^}]*)\}/);
  assert.ok(m, "SLA_HOURS not found in labels.ts");
  const front = Object.fromEntries([...m[1].matchAll(/(\w+):\s*(\d+)/g)].map(([, k, v]) => [k, Number(v)]));
  assert.deepEqual(front, SLA_HOURS);
});

// ── ticket_digest ───────────────────────────────────────────────────────────

test("ticket_digest: grouped by system, short summary and latest comment", () => {
  const w = periodWindow("week", "", "", "2026-11-26");
  const body = {
    total: 3,
    tickets: [
      { code: "HC-9", system_code: "HC", system_name: "Houzs Century", title: "Invoice PDF blank", status: "open", priority: "high", type: "bug", description: "word ".repeat(100), reporter_name: "Lim", assignee_name: null, created_at: "2026-11-26T01:00:00Z", latest_comment: { author_name: "Ann", visibility: "internal", created_at: "2026-11-26T02:00:00Z", body: "Checking the template" } },
      { code: "HK-8", system_code: "HK", system_name: "Hookka", title: "Add a field", status: "in_progress", priority: "low", type: "development", description: "Short", created_at: "2026-11-24T01:00:00Z", latest_comment: null },
      { code: "HC-7", system_code: "HC", system_name: "Houzs Century", title: "Login slow", status: "resolved", priority: "medium", type: "bug", description: "Slow\n\nin the  morning", created_at: "2026-11-23T01:00:00Z", latest_comment: { author_name: "Lim", visibility: "public", created_at: "2026-11-25T01:00:00Z", body: "Fine now" } },
    ],
  };
  const r = summariseDigest(body, { total: 1 }, w, O);
  assert.equal(r.raised, 3);
  assert.deepEqual(r.previousPeriod, { from: "2026-11-16", to: "2026-11-19", raised: 1, change: 2 });
  assert.deepEqual(r.bySystem.map((g) => [g.system, g.name, g.count]), [["HC", "Houzs Century", 2], ["HK", "Hookka", 1]]);
  const [first, second] = r.bySystem[0].tickets;
  assert.ok(first.summary.length <= 201 && first.summary.endsWith("…"));
  assert.deepEqual(first.latestComment, { by: "Ann", at: "2026-11-26", internal: true, text: "Checking the template" });
  assert.equal(second.summary, "Slow in the morning");
  assert.equal(second.latestComment.internal, undefined);
  assert.equal(r.bySystem[1].tickets[0].latestComment, null);
  assert.equal(r.note, undefined);
  const cut = summariseDigest({ total: 50, tickets: body.tickets }, null, w, O);
  assert.match(cut.note, /newest 3 of 50/);
  assert.equal(cut.previousPeriod, undefined);
});

test("trimText cuts on a word with an ellipsis", () => {
  assert.equal(trimText("a b c", 10), "a b c");
  assert.equal(trimText("hello world again", 12), "hello world…");
  assert.equal(trimText(null, 5), "");
});

// ── fetch (ticket lookup) shows the assignee ────────────────────────────────

test("fetch: the assignee comes from the last assign event; unassigned when none", () => {
  const ev = [
    { kind: "assign", authorName: "Ann", fromValue: null, toValue: "Ann", createdAt: "2026-11-20T02:00:00Z" },
    { kind: "assign", authorName: "Lead", fromValue: "Ann", toValue: "Ben", createdAt: "2026-11-21T02:00:00Z" },
  ];
  const doc = ticketDocument({ ticket: { code: "HC-1", assigneeId: 4, status: "in_progress" }, events: ev }, O, 30_000);
  assert.match(doc.text, /Assignee: Ben/);
  assert.equal(doc.metadata.assignee, "Ben");
  const none = ticketDocument({ ticket: { code: "HC-2", assigneeId: null }, events: ev }, O, 30_000);
  assert.match(none.text, /Assignee: unassigned/);
  assert.equal(none.metadata.assignee, null);
});

// ── permissions: the hub decides, the connector only reports it ─────────────
// A fake hub that refuses exactly as the routes do: need("it") on /dev/tickets/*,
// need("billing_view", "billing_edit") on GET /dev/billing, need("accounts_view",
// "accounts_edit") on GET /dev/accounts (the next test pins those guards in the source).

const GATES = {
  "/api/v1/dev/tickets/report": ["it"],
  "/api/v1/dev/tickets/digest": ["it"],
  "/api/v1/dev/billing": ["billing_view", "billing_edit"],
  "/api/v1/dev/accounts": ["accounts_view", "accounts_edit"],
};
const DATA = {
  "/api/v1/dev/tickets/report": REPORT,
  "/api/v1/dev/tickets/digest": { total: 1, tickets: [{ code: "HC-9", system_code: "HC", title: "Secret title", description: "secret body", created_at: "2026-11-26T01:00:00Z" }] },
  "/api/v1/dev/billing": { charges: [{ id: 1, vendor: "Cloudflare", status: "confirmed", amount: null, card: "", systemCode: "", splits: [], splitByUsage: 0, accountId: null, checkedOn: null }] },
  "/api/v1/dev/accounts": { accounts: [{ id: 1, name: "Google Workspace", mainOwner: "", itAccess: "", billsTo: "" }] },
};
function fakeHub(perms) {
  const calls = [];
  const read = async (path, query) => {
    calls.push(path);
    const gate = GATES[path];
    if (!gate) return { ok: false, status: 404, message: "The hub answered: Not found" };
    if (!gate.some((p) => perms.includes(p))) return { ok: false, status: 403, message: "Not available to your role: you do not have permission for this in the hub.", note: "no permission" };
    return { ok: true, value: DATA[path] };
  };
  return { calls, deps: { read, origin: O, today: "2026-11-26", nowMs: NOW } };
}

test("permissions: a role without IT tickets gets 'no access' and no ticket data", async () => {
  for (const name of ["tickets_overdue", "ticket_digest"]) {
    const { calls, deps } = fakeHub(["billing_view"]);
    const r = await runRound4Tool(name, {}, deps);
    assert.equal(r.ok, false, name);
    assert.equal(r.status, 403);
    assert.equal(r.message, "You do not have access to IT tickets in the hub.");
    assert.doesNotMatch(JSON.stringify(r), /HC-|Secret|Down/);
    assert.ok(calls.every((p) => ROUND4_ENDPOINTS[name].includes(p)), `${name} read ${calls}`);
  }
});

test("permissions: data_gaps shows only the parts the role may open", async () => {
  const itOnly = fakeHub(["it"]);
  const r = await runRound4Tool("data_gaps", {}, itOnly.deps);
  assert.equal(r.ok, true);
  assert.equal(r.body.tickets.noAssignee.total, 3);
  assert.deepEqual(r.body.billing, { unavailable: "You do not have access to system billing in the hub." });
  assert.deepEqual(r.body.accounts, { unavailable: "You do not have access to account ownership in the hub." });
  assert.doesNotMatch(JSON.stringify(r.body), /Cloudflare|Google Workspace/);

  const nothing = fakeHub([]);
  const n = await runRound4Tool("data_gaps", {}, nothing.deps);
  assert.deepEqual(n.body.tickets, { unavailable: "You do not have access to IT tickets in the hub." });
  assert.doesNotMatch(JSON.stringify(n.body), /HC-|Cloudflare|Google Workspace/);

  const finance = fakeHub(["it", "billing_view", "accounts_view"]);
  const f = await runRound4Tool("data_gaps", {}, finance.deps);
  assert.equal(f.body.billing.noAmount.total, 1);
  assert.equal(f.body.billing.noSystem.items[0].vendor, "Cloudflare");
  assert.equal(f.body.accounts.noMainOwner.items[0].name, "Google Workspace");
  assert.ok(finance.calls.every((p) => ROUND4_ENDPOINTS.data_gaps.includes(p)));
});

test("permissions: the endpoints the tools read are guarded as the table says", () => {
  const dev = src("../src/routes/dev.ts");
  assert.match(dev, /dev\.use\("\/tickets\/\*", need\("it"\)\)/);
  const digest = dev.indexOf('dev.get("/tickets/digest"');
  const report = dev.indexOf('dev.get("/tickets/report"');
  assert.ok(digest > 0 && report > 0);
  // Registered before /tickets/:code, or ":code" would swallow "digest".
  assert.ok(digest < dev.indexOf('dev.get("/tickets/:code"'));
  assert.match(src("../src/routes/billing.ts"), /billing\.get\("\/", need\("billing_view", "billing_edit"\)/);
  assert.match(src("../src/routes/accounts.ts"), /accounts\.get\("\/", need\("accounts_view", "accounts_edit"\)/);
  // Every round-4 endpoint goes through the hub's own GET routes under /api/v1/dev.
  for (const paths of Object.values(ROUND4_ENDPOINTS)) for (const p of paths) assert.ok(GATES[p], p);
});

test("tools/list: round-4 tools are read-only with a schema", () => {
  assert.deepEqual(ROUND4_TOOLS.map((t) => t.name), ["tickets_overdue", "ticket_digest", "data_gaps"]);
  for (const t of ROUND4_TOOLS) {
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.inputSchema.type, "object");
  }
  assert.ok(ROUND4_TOOLS[1].inputSchema.properties.period.enum.includes("last_month"));
});

test("ticket_digest: bad period is refused before any read", async () => {
  const { calls, deps } = fakeHub(["it"]);
  const r = await runRound4Tool("ticket_digest", { period: "custom", from: "2026-11-01" }, deps);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
  assert.equal(await runRound4Tool("nope", {}, deps), null);
});
