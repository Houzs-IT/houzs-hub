// AI Connector round 4d: the morning brief / alerts logic (src/services/proactive.ts), the
// group monthly report builder (src/services/group-report.ts) with fixture company_report
// answers, the token sealing (src/services/group-crypto.ts) and the MCP client
// (src/services/mcp-client.ts) against a stand-in fetch. No real system is ever called.
// Run: npm --prefix backend test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alertsToSend,
  buildAlertEmail,
  buildBriefEmail,
  computeAlerts,
  isBriefDue,
  mytNow,
  parseSubscriptionInput,
  pickTickWork,
  PROACTIVE_CONFIG,
} from "../src/services/proactive.ts";
import {
  answerOf,
  buildGroupReport,
  GROUP_SYSTEMS,
  monthlyDue,
  normalise,
  renderReportHtml,
  renderReportText,
  shiftMonth,
  validReportMonth,
  vsPrevious,
} from "../src/services/group-report.ts";
import { keyConfigured, seal, unseal } from "../src/services/group-crypto.ts";
import { authorizeUrl, callTool, discover, exchangeCode, McpClientError, parseRpcReply, pkcePair, refreshAccess, registerClient } from "../src/services/mcp-client.ts";

const O = "https://support.example";
// 2026-11-26 is a Thursday. 00:00 UTC = 08:00 Malaysia time.
const at = (iso) => Date.parse(iso);

// ── D1: opt-in and the brief ────────────────────────────────────────────────

test("subscription: defaults off, refuses bad values", () => {
  const ok = parseSubscriptionInput({}, 7);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { userId: 7, briefEnabled: false, briefTime: "08:00", briefDays: "weekdays", alertsEnabled: false });
  assert.equal(parseSubscriptionInput({ briefTime: "08:15" }, 7).ok, false, "only on the hour / half hour");
  assert.equal(parseSubscriptionInput({ briefEnabled: "yes" }, 7).ok, false);
  assert.equal(parseSubscriptionInput({ briefDays: "monthly" }, 7).ok, false);
  assert.equal(parseSubscriptionInput(null, 7).ok, false);
  assert.equal(parseSubscriptionInput({ briefEnabled: true, briefTime: "07:30", briefDays: "daily" }, 7).value.briefTime, "07:30");
});

test("brief due: at or after the time, within the cutoff, weekdays only unless daily", () => {
  const sub = { userId: 1, briefEnabled: true, briefTime: "08:00", briefDays: "weekdays", alertsEnabled: false };
  assert.equal(isBriefDue(sub, mytNow(at("2026-11-25T23:55:00Z"))), false, "07:55 is early");
  assert.equal(isBriefDue(sub, mytNow(at("2026-11-26T00:00:00Z"))), true, "08:00 Thursday");
  assert.equal(isBriefDue(sub, mytNow(at("2026-11-26T04:30:00Z"))), false, "12:30 is past the 4 h cutoff");
  assert.equal(isBriefDue(sub, mytNow(at("2026-11-28T00:00:00Z"))), false, "Saturday");
  assert.equal(isBriefDue({ ...sub, briefDays: "daily" }, mytNow(at("2026-11-28T00:00:00Z"))), true);
  assert.equal(isBriefDue({ ...sub, briefEnabled: false }, mytNow(at("2026-11-26T00:00:00Z"))), false, "off by default");
});

test("tick work: briefs not sent today, alerts only in hours, least recently checked first, capped", () => {
  const nowMs = at("2026-11-26T02:00:00Z"); // 10:00 Malaysia
  const now = mytNow(nowMs);
  const mk = (id, extra) => ({ userId: id, briefEnabled: true, briefTime: "08:00", briefDays: "weekdays", alertsEnabled: true, lastAlertCheckAt: "", ...extra });
  const subs = [mk(1), mk(2, { lastAlertCheckAt: new Date(nowMs - 5 * 60_000).toISOString() }), mk(3, { lastAlertCheckAt: new Date(nowMs - 60 * 60_000).toISOString() })];
  const w = pickTickWork(subs, now, new Set([1]), nowMs);
  assert.deepEqual(w.briefs.map((s) => s.userId), [2, 3], "1 already briefed today");
  assert.deepEqual(w.alerts.map((s) => s.userId), [1, 3], "2 was checked 5 minutes ago; never-checked first");
  const night = mytNow(at("2026-11-26T13:00:00Z")); // 21:00
  assert.equal(pickTickWork(subs, night, new Set(), at("2026-11-26T13:00:00Z")).alerts.length, 0);
  const many = Array.from({ length: 40 }, (_, i) => mk(i + 1));
  const capped = pickTickWork(many, now, new Set(), nowMs);
  assert.equal(capped.briefs.length, PROACTIVE_CONFIG.maxBriefsPerTick);
  assert.equal(capped.alerts.length, PROACTIVE_CONFIG.alerts.maxPeoplePerTick);
});

const BRIEF = {
  day: "2026-11-26",
  myOpenTickets: { count: 3, highPriority: 1, waitingOnReporter: 0, openOver7Days: 1, top: [{ code: "HC-0042", title: "Printer <script>", system: "HC", priority: "high", status: "in_progress", ageDays: 9, url: `${O}/tickets/HC-0042` }] },
  unassignedHighPriority: { count: 0, top: [] },
  myMeetingsToday: { unavailable: "You do not have access to meetings in the hub." },
  unreadNotifications: { count: 1, top: [{ ticket: "HK-0007", title: "Login fails", what: "comment", by: "Amy", at: "2026-11-26T01:00:00Z" }] },
};
const GAPS = {
  tickets: { openTickets: 10, noAssignee: { total: 4, items: [] }, noModule: { total: 0, items: [] } },
  billing: { unavailable: "You do not have access to system billing in the hub." },
  accounts: { accounts: 3, noMainOwner: { total: 1, items: [] }, noItAccess: { total: 0, items: [] }, noBillsTo: { total: 2, items: [] } },
};

test("brief email: sections with counts and links, escaped, unavailable said plainly, gaps on Monday", () => {
  const m = buildBriefEmail({ brief: BRIEF, gaps: null, name: "Lee", date: "2026-11-26", origin: O, settingsUrl: `${O}/ai-connector`, unsubscribeUrl: `${O}/api/v1/ai-brief/unsubscribe?t=x` });
  assert.match(m.subject, /2026-11-26: 4 items/);
  assert.match(m.html, /href="https:\/\/support\.example\/tickets\/HC-0042"/);
  assert.ok(!m.html.includes("<script>"), "titles are escaped");
  assert.match(m.html, /Printer &lt;script&gt;/);
  assert.match(m.html, /You do not have access to meetings/);
  assert.match(m.html, /Unsubscribe/);
  assert.ok(!m.html.includes("Data gaps"));
  assert.match(m.text, /HC-0042/);
  const mon = buildBriefEmail({ brief: BRIEF, gaps: GAPS, name: "Lee", date: "2026-11-30", origin: O, settingsUrl: "s", unsubscribeUrl: "" });
  assert.match(mon.html, /Data gaps: tickets/);
  assert.match(mon.html, /Open tickets with no assignee: 4/);
  assert.match(mon.html, /Accounts with no bills-to: 2/);
  assert.ok(!mon.html.includes("system billing"), "a gap area without access is left out");
  assert.match(buildBriefEmail({ brief: BRIEF, gaps: null, name: "", date: "d", origin: O, settingsUrl: "s", unsubscribeUrl: "", test: true }).subject, /^\[Test\]/);
});

// ── D2: alerts ──────────────────────────────────────────────────────────────

const OVERDUE = {
  urgentUnassigned: {
    total: 2,
    tickets: [
      { code: "HC-0100", title: "POS down", system: "HC", priority: "high", hoursUsed: 3, url: `${O}/tickets/HC-0100` },
      { code: "HC-0101", title: "Just raised", system: "HC", priority: "high", hoursUsed: 0 },
    ],
  },
  pastSla: {
    total: 2,
    tickets: [
      { code: "HK-0001", title: "Old one", system: "HK", priority: "medium", slaHours: 72, hoursOver: 200, assignee: "Tan" },
      { code: "HK-0002", title: "Just over", system: "HK", priority: "high", slaHours: 24, hoursOver: 2, assignee: null },
    ],
  },
};
const HEALTH = { down: [{ name: "Houzs ERP", system: "Houzs Century", error: "HTTP 502", downSince: "2026-11-26T01:10:00Z" }], slow: [] };

test("alerts: urgent unassigned over 1 h, newly past SLA only, health only when given", () => {
  const a = computeAlerts({ overdue: OVERDUE, health: HEALTH, origin: O });
  assert.deepEqual(a.map((x) => x.key), ["urgent:HC-0100", "sla:HK-0002", "health:Houzs ERP"]);
  assert.equal(a[1].link, `${O}/tickets/HK-0002`);
  const noHealth = computeAlerts({ overdue: OVERDUE, health: null, origin: O });
  assert.ok(!noHealth.some((x) => x.kind === "health"), "no health_view: no health alerts");
  assert.deepEqual(computeAlerts({ overdue: null, health: null, origin: O }), [], "no access: nothing");
});

test("alerts: at most one email per alert per day (debounce), duplicates dropped", () => {
  const a = computeAlerts({ overdue: OVERDUE, health: HEALTH, origin: O });
  const fresh = alertsToSend([...a, a[0]], new Set(["sla:HK-0002"]));
  assert.deepEqual(fresh.map((x) => x.key), ["urgent:HC-0100", "health:Houzs ERP"]);
  const mail = buildAlertEmail({ alerts: fresh, name: "Lee", date: "2026-11-26", settingsUrl: "s", unsubscribeUrl: "u" });
  assert.match(mail.subject, /and 1 more/);
  assert.match(mail.html, /Systems failing their health check/);
  const capped = buildAlertEmail({ alerts: a, name: "", date: "d", settingsUrl: "s", unsubscribeUrl: "", maxLines: 1 });
  assert.match(capped.html, /And 2 more/);
});

// ── D3: token sealing ───────────────────────────────────────────────────────

test("seal / unseal: round trip, bound to its place, key and content", async () => {
  const key = "a-long-random-group-report-key-0123456789";
  const box = await seal(key, "hkmcpr_secret-refresh", "hookka:refresh");
  assert.match(box, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(!box.includes("secret-refresh"));
  assert.equal(await unseal(key, box, "hookka:refresh"), "hkmcpr_secret-refresh");
  assert.notEqual(await seal(key, "x", "a"), await seal(key, "x", "a"), "fresh IV each time");
  await assert.rejects(unseal(key, box, "houzs:refresh"), "another row / field does not open it");
  await assert.rejects(unseal("another-long-random-key-9876543210", box, "hookka:refresh"));
  const [v, iv, ct] = box.split(".");
  const flipped = ct.slice(0, -2) + (ct.at(-2) === "A" ? "B" : "A") + ct.at(-1);
  await assert.rejects(unseal(key, `${v}.${iv}.${flipped}`, "hookka:refresh"), "tampered");
  assert.equal(keyConfigured(undefined), false);
  assert.equal(keyConfigured("short"), false);
  await assert.rejects(seal("short", "x", "a"), /not configured/);
});

// ── D3: the report builder, from fixture company_report answers ────────────

const HOOKKA = {
  period: "month",
  label: "2026-10",
  profitAndLoss: { revenueRm: 1200000, grossProfitRm: 300000, grossMarginPct: 25, netProfitRm: 80000 },
  previousPeriod: { revenueRm: 1000000, grossProfitRm: 260000, grossMarginPct: 26, netProfitRm: 90000 },
  cashFlow: { operatingRm: 50000, investingRm: -10000, financingRm: 0, netRm: 40000, previousNetRm: -5000 },
  balanceSheet: { asAt: "2026-10", inventoryRm: 450000 },
  receivablesNow: { owedToUsRm: 700000, over60DaysRm: 120000 },
  payablesNow: { weOweRm: 400000, over60DaysRm: 30000 },
  production: { productionRevenueRm: 900000 },
  headcount: { now: 120, previous: 118 },
};
const HOUZS = {
  period: "2026-10",
  profitAndLoss: { salesRm: 800000, costOfSalesRm: 500000, grossProfitRm: 300000, netProfitRm: 50000, grossMarginPct: 37.5, previous: { salesRm: 760000, grossProfitRm: 290000, netProfitRm: 45000 } },
  salesOrders: { orders: 400, salesRm: 950000, previousRm: 900000 },
  receivables: { totalRm: 210000 },
  payables: { totalRm: 330000 },
  afterSales: { openCases: 12, pastDeadline: 3 },
};
const HOUZS_NO_PL = { period: "2026-10", profitAndLoss: null, receivables: null, payables: null, salesOrders: { orders: 50, salesRm: 100000 }, notAvailable: ["the financial statements (P&L)"] };
const CONTS = { company: "The Conts", headline: { thisPeriod: { occupancyPct: 71.2, reservationIncomeRm: 180000, activeUnits: 60 }, previous: { occupancyPct: 65, reservationIncomeRm: 150000 } }, ownerStatements: { netPayoutToOwnersRm: 120000 }, reservations: { reservations: 300, nights: 1200 } };
const HRIS = {
  period: "2026-10",
  group: { people: { headcountEnd: 210, joined: 6, left: 4, turnoverPct: 1.9 }, payroll: { employerCostRM: 900000, previous: { employerCostRM: 880000 } }, claims: { approvedRM: 12000 }, overtime: { approvedHours: 340 } },
  companies: [
    { company: "Houzs Century", people: { headcountEnd: 150, joined: 4, left: 3 }, payroll: { employerCostRM: 650000 } },
    { company: "2990s", people: { headcountEnd: 60, joined: 2, left: 1 }, payroll: "You do not have access to payroll." },
  ],
};
const tool = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });

test("normalise: the same metrics from each system's own shape; missing stays empty, never 0", () => {
  const h = normalise("hookka", HOOKKA).metrics;
  assert.deepEqual(h.revenue, { value: 1200000, previous: 1000000 });
  assert.deepEqual(h.cash, { value: 40000, previous: -5000 });
  assert.deepEqual(h.receivables, { value: 700000, previous: null });
  assert.deepEqual(h.headcount, { value: 120, previous: 118 });
  const z = normalise("houzs", HOUZS).metrics;
  assert.deepEqual(z.revenue, { value: 800000, previous: 760000 });
  assert.deepEqual(z.cash, { value: null, previous: null });
  const noPl = normalise("houzs", HOUZS_NO_PL);
  assert.equal(noPl.metrics.revenue.value, null, "no finance access: no revenue, not 0");
  assert.match(noPl.notes.join(" "), /needs finance access/);
  const c = normalise("conts", CONTS);
  assert.deepEqual(c.metrics.revenue, { value: 180000, previous: 150000 });
  assert.equal(c.metrics.grossProfit.value, null);
  const p = normalise("hris", HRIS);
  assert.deepEqual(p.metrics.headcount, { value: 210, previous: 208 }, "previous = end - joined + left");
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[1].cells[2].value, "no access");
});

test("answerOf: structuredContent, JSON text, a note line before the JSON, refusals", () => {
  assert.deepEqual(answerOf({ structuredContent: { a: 1 }, content: [] }), { status: "ok", answer: { a: 1 } });
  assert.deepEqual(answerOf(tool({ b: 2 })), { status: "ok", answer: { b: 2 } });
  assert.deepEqual(answerOf({ content: [{ type: "text", text: 'Credential fields removed: x.\n{"c":3}' }] }), { status: "ok", answer: { c: 3 } });
  assert.equal(answerOf({ isError: true, content: [{ type: "text", text: "Not available to your role: you do not have permission" }] }).status, "no_access");
  assert.equal(answerOf({ isError: true, content: [{ type: "text", text: "Give period as month" }] }).status, "error");
  assert.equal(answerOf({ content: [{ type: "text", text: "plain words" }] }).status, "error");
});

test("group report: summary totals over reporting companies, like-for-like previous, plain status lines", () => {
  const outcomes = {
    hookka: { Hookka: answerOf(tool(HOOKKA)) },
    houzs: { "Houzs Century": answerOf(tool(HOUZS)), "2990s": { status: "no_access", message: "You do not have access to the P&L." } },
    hris: { "People (HRIS, every company)": answerOf(tool(HRIS)) },
    // conts not connected
  };
  const r = buildGroupReport("2026-10", outcomes, "2026-11-01T01:00:00.000Z");
  assert.equal(r.previousMonth, "2026-09");
  assert.deepEqual(r.totals.revenue, { value: 2000000, previous: 1760000, companies: 2 });
  assert.deepEqual(r.totals.cash, { value: 40000, previous: -5000, companies: 1 });
  assert.equal(r.totals.receivables.value, 910000);
  assert.equal(r.totals.headcount.value, null, "headcount is not added up across systems");
  const st = Object.fromEntries(r.systems.map((x) => [x.key, x.status]));
  assert.deepEqual(st, { hookka: "connected", houzs: "partial", conts: "not_connected", hris: "connected" });
  const conts = r.companies.find((c) => c.company === "The Conts");
  assert.equal(conts.status, "not_connected");
  assert.match(conts.message, /not connected/);
  assert.match(r.companies.find((c) => c.company === "2990s").message, /No access/);
  assert.equal(r.companies.length, GROUP_SYSTEMS.reduce((n, s) => n + s.calls.length, 0), "one section per company, connected or not");
});

test("group report HTML: summary first, a section per company, vs previous month, escaped", () => {
  const evil = { ...HOUZS, salesOrders: { salesRm: 1, previousRm: 1 }, afterSales: { pastDeadline: "<img src=x onerror=alert(1)>" } };
  const r = buildGroupReport("2026-10", { hookka: { Hookka: answerOf(tool(HOOKKA)) }, houzs: { "Houzs Century": answerOf(tool(evil)) } }, "2026-11-01T01:00:00.000Z");
  const html = renderReportHtml(r, { hubUrl: O });
  assert.ok(html.indexOf("Group summary") < html.indexOf("Hookka <span"), "summary before the company sections");
  assert.match(html, /Group report: October 2026/);
  assert.match(html, /Compared with September 2026/);
  assert.match(html, /RM 1,200,000/);
  assert.match(html, /vs RM 1,000,000 \(\+20\.0%\)/);
  assert.match(html, /The Conts ERP is not connected to the group report/);
  assert.ok(!html.includes("<img src=x"), "answers from systems are escaped");
  assert.ok(!/<script/i.test(html));
  assert.match(renderReportText(r, { hubUrl: O }), /Revenue: RM 1,200,000 vs RM 1,000,000/);
  assert.equal(vsPrevious("receivables", { value: 1, previous: null }), "today");
  assert.equal(vsPrevious("revenue", { value: 5, previous: null }), "no month-before figure");
  assert.equal(vsPrevious("netProfit", { value: 80, previous: 100 }), "vs RM 100 (-20.0%)");
});

test("schedule: the 1st from 09:00 Malaysia time builds last month; months are checked", () => {
  assert.equal(monthlyDue(at("2026-12-01T00:59:00Z")), null, "08:59 on the 1st");
  assert.equal(monthlyDue(at("2026-12-01T01:00:00Z")), "2026-11");
  assert.equal(monthlyDue(at("2027-01-01T05:00:00Z")), "2026-12", "across the year");
  assert.equal(monthlyDue(at("2026-12-02T01:00:00Z")), null);
  assert.equal(monthlyDue(at("2026-11-30T17:00:00Z")), null, "01:00 on the 1st (Malaysia) is before 09:00");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  const now = at("2026-11-27T04:00:00Z");
  assert.equal(validReportMonth("2026-11", now), true);
  assert.equal(validReportMonth("2026-12", now), false, "not the future");
  assert.equal(validReportMonth("2026-13", now), false);
  assert.equal(validReportMonth("Nov", now), false);
});

test("company_report arguments match each system's own names", () => {
  const args = Object.fromEntries(GROUP_SYSTEMS.flatMap((s) => s.calls.map((c) => [`${s.key}/${c.company}`, c.args("2026-10")])));
  assert.deepEqual(args["hookka/Hookka"], { period: "month", month: "2026-10" });
  assert.deepEqual(args["houzs/Houzs Century"], { period: "2026-10" });
  assert.deepEqual(args["houzs/2990s"], { period: "2026-10", company: "2990" });
  assert.deepEqual(args["conts/The Conts"], { period: "month", month: "2026-10" });
  assert.deepEqual(args["conts/Dream Crafter"], { period: "month", month: "2026-10", company: "Dream Crafter" });
  assert.deepEqual(args["hris/People (HRIS, every company)"], { period: "2026-10" });
  for (const s of GROUP_SYSTEMS) assert.match(s.mcpUrl, /^https:\/\//);
});

// ── D3: the MCP client, against a stand-in fetch ────────────────────────────

function standIn(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    const h = routes(u, init, calls);
    if (!h) return new Response("not found", { status: 404 });
    return new Response(typeof h.body === "string" ? h.body : JSON.stringify(h.body), { status: h.status ?? 200, headers: { "content-type": h.type ?? "application/json", ...(h.headers ?? {}) } });
  };
  return { f, calls };
}

test("discover + register + authorize URL: RFC 9728 → 8414, public client, PKCE S256, resource", async () => {
  const { f, calls } = standIn((u) => {
    if (u === "https://erp.example/.well-known/oauth-protected-resource/api/mcp") return { body: { resource: "https://erp.example/api/mcp", authorization_servers: ["https://erp.example"] } };
    if (u === "https://erp.example/.well-known/oauth-authorization-server")
      return { body: { authorization_endpoint: "https://erp.example/api/mcp/oauth/authorize", token_endpoint: "https://erp.example/api/mcp/oauth/token", registration_endpoint: "https://erp.example/api/mcp/oauth/register" } };
    if (u === "https://erp.example/api/mcp/oauth/register") return { status: 201, body: { client_id: "mcpc_123" } };
    return null;
  });
  const meta = await discover("https://erp.example/api/mcp", f);
  assert.equal(meta.tokenEndpoint, "https://erp.example/api/mcp/oauth/token");
  const id = await registerClient(meta, `${O}/api/v1/group-report/callback`, f);
  assert.equal(id, "mcpc_123");
  const reg = JSON.parse(calls.find((x) => x.url.endsWith("/register")).init.body);
  assert.equal(reg.token_endpoint_auth_method, "none");
  assert.deepEqual(reg.redirect_uris, [`${O}/api/v1/group-report/callback`]);
  const { verifier, challenge } = await pkcePair();
  assert.ok(verifier.length >= 43 && challenge.length === 43);
  const url = new URL(authorizeUrl({ meta, clientId: id, redirectUri: `${O}/cb`, state: "st", challenge }));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("resource"), "https://erp.example/api/mcp");
  await assert.rejects(discover("http://erp.example/api/mcp", f), /https/);
});

test("token exchange / refresh: form body, expiry, invalid_grant, a failure never echoes a token", async () => {
  const { f, calls } = standIn((u, init) => {
    const form = new URLSearchParams(String(init.body));
    if (form.get("grant_type") === "authorization_code") return { body: { access_token: "AT1", refresh_token: "RT1", expires_in: 86400 } };
    if (form.get("refresh_token") === "RT1") return { body: { access_token: "AT2", refresh_token: "RT2", expires_in: 60 } };
    return { status: 400, body: { error: "invalid_grant", error_description: "refresh RT-bad is revoked" } };
  });
  const t = await exchangeCode({ tokenEndpoint: "https://erp.example/t", code: "c", verifier: "v", clientId: "id", redirectUri: `${O}/cb`, resource: "https://erp.example/api/mcp" }, f, at("2026-11-01T00:00:00Z"));
  assert.deepEqual(t, { accessToken: "AT1", refreshToken: "RT1", expiresAt: "2026-11-02T00:00:00.000Z" });
  assert.match(calls[0].init.headers["content-type"], /x-www-form-urlencoded/);
  assert.equal((await refreshAccess({ tokenEndpoint: "https://erp.example/t", refreshToken: "RT1", clientId: "id", resource: "r" }, f)).accessToken, "AT2");
  await assert.rejects(refreshAccess({ tokenEndpoint: "https://erp.example/t", refreshToken: "RT-bad", clientId: "id", resource: "r" }, f), (e) => e instanceof McpClientError && e.code === "invalid_grant" && !e.message.includes("RT-bad"));
});

test("callTool: initialize → initialized → tools/call with the session id; JSON and SSE answers; 401", async () => {
  const seen = [];
  const { f } = standIn((u, init) => {
    const m = JSON.parse(String(init.body));
    seen.push({ method: m.method, session: init.headers["mcp-session-id"] ?? "", auth: init.headers.authorization });
    if (m.method === "initialize") return { body: { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }, headers: { "mcp-session-id": "S1" } };
    if (m.method === "notifications/initialized") return { status: 202, body: "" };
    if (m.method === "tools/call") return { type: "text/event-stream", body: `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: tool(HOOKKA) })}\n\n` };
    return null;
  });
  const r = await callTool("https://erp.example/api/mcp", "AT", "company_report", { period: "month", month: "2026-10" }, f);
  assert.deepEqual(seen.map((x) => x.method), ["initialize", "notifications/initialized", "tools/call"]);
  assert.equal(seen[2].session, "S1");
  assert.equal(seen[2].auth, "Bearer AT");
  assert.equal(answerOf(r).answer.headcount.now, 120);
  const denied = standIn(() => ({ status: 401, body: { error: "invalid_token" } }));
  await assert.rejects(callTool("https://erp.example/api/mcp", "AT", "company_report", {}, denied.f), (e) => e instanceof McpClientError && e.code === "unauthorized");
  assert.deepEqual(parseRpcReply("application/json", JSON.stringify([{ id: 9 }, { id: 2, result: { ok: 1 } }]), 2), { id: 2, result: { ok: 1 } });
  assert.equal(parseRpcReply("application/json", "nope", 2), null);
});
