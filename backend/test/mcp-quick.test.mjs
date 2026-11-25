// AI Connector quick answers (src/services/mcp-quick.ts) and the one-check-per-lookup
// memory (src/services/mcp-inner.ts). Run: npm --prefix backend test (Node 22.18+ loads .ts directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  myToday,
  pickFields,
  promptText,
  PROMPTS,
  shiftMonth,
  summariseHealth,
  summariseTickets,
  TICKET_CODE,
  ticketDocument,
  ticketSearchResults,
  ticketWindow,
} from "../src/services/mcp-quick.ts";
import { forgetVerified, recallVerified, rememberVerified, VERIFIED_TTL_MS } from "../src/services/mcp-inner.ts";

const NOW = Date.parse("2026-11-25T04:00:00Z"); // 12:00 in Malaysia

test("dates: Malaysia today and month shifts", () => {
  assert.equal(myToday(new Date("2026-11-25T17:00:00Z")), "2026-11-26");
  assert.equal(shiftMonth("2026-01", 1), "2025-12");
  assert.equal(shiftMonth("2026-11", 5), "2026-06");
});

test("ticket window picks the smallest report range", () => {
  const today = "2026-11-25";
  assert.deepEqual(ticketWindow(undefined, undefined, today), { from: "2026-11-01", to: "2026-11-25", range: "this", granularity: "day" });
  assert.deepEqual(ticketWindow("2026-10-03", "2026-10-20", today), { from: "2026-10-03", to: "2026-10-20", range: "last", granularity: "day" });
  assert.equal(ticketWindow("2026-07-01", "2026-11-25", today).range, 6);
  assert.equal(ticketWindow("2026-01-01", "2026-03-31", today).range, 12);
  assert.ok("error" in ticketWindow("2025-10-01", "2025-12-31", today));
  assert.ok("error" in ticketWindow("2026-11-20", "2026-11-01", today));
  assert.ok("error" in ticketWindow("bad", undefined, today));
  // A future "to" is clamped to today.
  assert.equal(ticketWindow("2026-11-01", "2026-12-31", today).to, today);
});

const report = {
  open_tickets: [
    { code: "HC-0001", title: "Old printer issue", sys: "HC", status: "open", priority: "low", created_at: "2026-09-01T02:00:00Z", assignee: null },
    { code: "HC-0007", title: "Invoices not saving", sys: "HC", status: "in_progress", priority: "high", created_at: "2026-11-20T02:00:00Z", assignee: "Ali" },
    { code: "HK-0003", title: "Login loop", sys: "HK", status: "waiting_reporter", priority: "high", created_at: "2026-11-10T02:00:00Z", assignee: "Mei" },
    { code: "HK-0004", title: "Slow report", sys: "HK", status: "in_progress", priority: "medium", created_at: "2026-11-22T02:00:00Z", assignee: "Ali" },
  ],
  flow_opened: [
    { k: "2026-11-02", sys: "HC", type: "bug", n: 3 },
    { k: "2026-11-20", sys: "HK", type: "bug", n: 2 },
    { k: "2026-10-30", sys: "HK", type: "bug", n: 9 },
  ],
  flow_done: [{ k: "2026-11-05", sys: "HC", type: "bug", n: 4 }],
  done: [
    { code: "HC-0002", k: "2026-11-05", sys: "HC", period: "now", hours: 10, it_hours: 8 },
    { code: "HC-0003", k: "2026-11-05", sys: "HC", period: "now", hours: 30, it_hours: 20 },
    { code: "HC-0004", k: "2026-10-05", sys: "HC", period: "prev", hours: 999, it_hours: 999 },
  ],
};

test("ticket summary: open now, new vs resolved, oldest and high priority", () => {
  const w = ticketWindow(undefined, undefined, "2026-11-25");
  const s = summariseTickets(report, { my_active: 2 }, w, null, NOW);
  assert.equal(s.openNow.total, 4);
  assert.deepEqual(s.openNow.byStatus, { open: 1, inProgress: 2, onHold: 0, testing: 0, waitingReporter: 1 });
  assert.equal(s.openNow.highPriority, 2);
  assert.equal(s.openNow.unassigned, 1);
  assert.equal(s.openNow.assignedToYou, 2);
  assert.deepEqual(Object.keys(s.openNow.byAssignee).sort(), ["Ali", "Mei", "Unassigned"]);
  assert.equal(Object.keys(s.openNow.byAssignee)[0], "Ali"); // busiest first
  assert.equal(s.openNow.bySystem.HC.inProgress, 1);
  assert.equal(s.inWindow.new, 5); // 30 Oct is outside the window
  assert.equal(s.inWindow.resolved, 4);
  assert.equal(s.inWindow.medianHoursToResolve, 20);
  assert.equal(s.inWindow.medianItHoursToResolve, 14);
  assert.equal(s.oldestOpen[0].code, "HC-0001");
  assert.equal(s.oldestOpen[0].ageDays, 85);
  assert.deepEqual(s.highPriorityOpen.map((t) => t.code), ["HK-0003", "HC-0007"]);
});

test("ticket summary filtered to one system", () => {
  const w = ticketWindow(undefined, undefined, "2026-11-25");
  const s = summariseTickets(report, { my_active: 2 }, w, "HK", NOW);
  assert.equal(s.openNow.total, 2);
  assert.equal(s.inWindow.new, 2);
  assert.equal(s.inWindow.resolved, 0);
  assert.equal(s.openNow.assignedToYou, undefined); // "mine" is across systems, so it is left out
});

test("health summary: down since, slow, uptime and system reports", () => {
  const at = (minsAgo) => new Date(NOW - minsAgo * 60_000).toISOString();
  const body = {
    targets: [
      { id: 1, name: "Houzs Century ERP", systemCode: "HC", active: 1 },
      { id: 2, name: "Hookka ERP", systemCode: "HK", active: 1 },
      { id: 3, name: "2990s", systemCode: null, active: 1 },
      { id: 4, name: "Retired", active: 0 },
      { id: 5, name: "New one", active: 1 },
    ],
    checks: [
      { targetId: 1, checkedAt: at(1), ok: 0, status: 502, ms: 100, error: "HTTP 502" },
      { targetId: 1, checkedAt: at(6), ok: 0, status: 502, ms: 100, error: "HTTP 502" },
      { targetId: 1, checkedAt: at(11), ok: 1, status: 200, ms: 300 },
      { targetId: 2, checkedAt: at(2), ok: 1, status: 200, ms: 3500 },
      { targetId: 3, checkedAt: at(2), ok: 1, status: 200, ms: 400 },
    ],
    systems: [
      { code: "HC", name: "Houzs Century" },
      { code: "HK", name: "Hookka" },
    ],
    reports: {
      latest: [
        { systemCode: "HK", receivedAt: at(3), ok: 0, report: { ok: false, checks: [{ key: "q", label: "Queue", status: "critical", summary: "Backlog 900" }, { key: "x", status: "ok" }] } },
        { systemCode: "HC", receivedAt: at(4), ok: 1, report: { ok: true, checks: [] } },
      ],
    },
  };
  const h = summariseHealth(body, NOW);
  assert.equal(h.down.length, 1);
  assert.equal(h.down[0].name, "Houzs Century ERP");
  assert.equal(h.down[0].downSince, at(6));
  assert.equal(h.down[0].uptime24hPct, 33.3);
  assert.equal(h.slow.length, 1);
  assert.equal(h.slow[0].ms, 3500);
  assert.equal(h.upCount, 1);
  assert.deepEqual(h.notCheckedYet, ["New one"]);
  assert.equal(h.systemReportsWithProblems[0].system, "Hookka");
  assert.equal(h.systemReportsWithProblems[0].problems[0].check, "Queue");
  assert.deepEqual(h.systemReportsOk, ["Houzs Century"]);
  assert.match(h.headline, /^1 down, 1 slow, 1 up/);
});

test("search and fetch return the shape ChatGPT requires", () => {
  const hits = ticketSearchResults({ tickets: [{ code: "HC-0007", title: "Invoices not saving", status: "in_progress", priority: "high", system_code: "HC" }, { title: "no code" }] }, "https://hub.example");
  assert.deepEqual(Object.keys(hits[0]).sort(), ["id", "title", "url"]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "HC-0007");
  assert.equal(hits[0].url, "https://hub.example/tickets/HC-0007");

  const doc = ticketDocument(
    {
      ticket: { code: "HC-0007", title: "Invoices not saving", systemCode: "HC", system_name: "Houzs Century", type: "bug", priority: "high", status: "in_progress", reporterName: "Lim", description: "Save does nothing", createdAt: "2026-11-20T02:00:00Z" },
      events: [
        { kind: "comment", visibility: "public", authorName: "Lim", body: "Still broken", createdAt: "2026-11-21T02:00:00Z", attachments: [{ filename: "shot.png" }] },
        { kind: "status", visibility: "public", authorName: "Ali", fromValue: "open", toValue: "in_progress", createdAt: "2026-11-21T03:00:00Z", attachments: [] },
      ],
    },
    "https://hub.example",
    30_000,
  );
  assert.deepEqual(Object.keys(doc).sort(), ["id", "metadata", "text", "title", "url"]);
  assert.match(doc.text, /Still broken \[files: shot\.png\]/);
  assert.match(doc.text, /status open → in_progress/);
  assert.equal(doc.metadata.events, 2);
  assert.equal(ticketDocument({ ticket: { code: "X-1", description: "a".repeat(500) } }, "o", 100).metadata.truncated, true);
  assert.ok(TICKET_CODE.test("HC-0042"));
  assert.ok(!TICKET_CODE.test("../sys"));
});

test("erp_get fields keeps only the named keys", () => {
  const v = { tickets: [{ code: "A-1", title: "t", description: "long" }], total: 1 };
  assert.deepEqual(pickFields(v, ["code", "total"]), { tickets: [{ code: "A-1" }], total: 1 });
  assert.equal(pickFields(v, []), v);
});

test("prompts", () => {
  assert.equal(PROMPTS.length, 3);
  for (const p of PROMPTS) assert.equal(typeof promptText(p.name, { query: "HC-1", system: "HC" }), "string");
  assert.equal(promptText("nope", {}), null);
  assert.match(promptText("find_ticket", { query: "HC-0042" }), /search/);
});

test("one token check per lookup: remembered for a few seconds only", () => {
  forgetVerified();
  rememberVerified("hbmcp_a", { user: { id: 1 } }, 1000);
  assert.deepEqual(recallVerified("hbmcp_a", 1000 + VERIFIED_TTL_MS - 1), { user: { id: 1 } });
  assert.equal(recallVerified("hbmcp_a", 1000 + VERIFIED_TTL_MS), null);
  assert.equal(recallVerified("hbmcp_b", 1000), null);
  rememberVerified("hbmcp_c", { user: { id: 2 } }, Date.now());
  forgetVerified();
  assert.equal(recallVerified("hbmcp_c"), null);
});
