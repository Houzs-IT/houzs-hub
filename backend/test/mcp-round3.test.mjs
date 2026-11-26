// AI Connector round 3 (src/services/mcp-round3.ts) and the xlsx writer (src/services/xlsx.ts).
// Run: npm --prefix backend test (Node 22.18+ loads .ts directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import {
  buildDailyBrief,
  cleanList,
  cleanSystems,
  DAILY_BRIEF_PROMPT,
  DAILY_BRIEF_TEXT,
  dayCount,
  exportFileName,
  inCreatedRange,
  myDay,
  myDayRange,
  pickColumns,
  RATE_LIMITS,
  rateLimitMessage,
  summariseMeetingsDay,
  summariseMyTickets,
  summariseTicketList,
  summariseTicketsToday,
  TICKET_EXPORT_COLUMNS,
  TICKET_STATUS_FILTERS,
} from "../src/services/mcp-round3.ts";
import { buildXlsx, colName, crc32, myDateTime, xmlEscape } from "../src/services/xlsx.ts";

const NOW = Date.parse("2026-11-26T04:00:00Z"); // 12:00 in Malaysia
const O = "https://support.example";

test("filters keep only known values", () => {
  assert.equal(cleanList("Active, bogus,high", TICKET_STATUS_FILTERS), "active");
  assert.equal(cleanList("open,in_progress", TICKET_STATUS_FILTERS), "open,in_progress");
  assert.equal(cleanSystems("hc, hk ,bad code!,2990"), "HC,HK,2990");
  assert.equal(dayCount(undefined, 3), 3);
  assert.equal(dayCount("10", 3), 10);
  assert.equal(dayCount(-4, 3), 0);
  assert.equal(dayCount(9999, 3), 365);
  assert.equal(dayCount("x", 3), 3);
});

test("Malaysia day helpers", () => {
  assert.equal(myDay("2026-11-25T17:30:00Z"), "2026-11-26");
  assert.deepEqual(myDayRange("2026-11-26"), { from: "2026-11-25T16:00:00.000Z", to: "2026-11-26T16:00:00.000Z" });
});

test("tickets_today: opened / resolved today, open now, urgent, overdue", () => {
  const report = {
    open_tickets: [
      { code: "HC-1", title: "Printer", sys: "HC", type: "bug", status: "open", priority: "high", created_at: "2026-11-26T01:00:00Z", module: "POS" },
      { code: "HK-2", title: "Old one", sys: "HK", type: "development", status: "in_progress", priority: "low", created_at: "2026-11-10T01:00:00Z" },
      { code: "HC-3", title: "Medium", sys: "HC", type: "bug", status: "open", priority: "medium", created_at: "2026-11-24T01:00:00Z", assignee: "Ann" },
    ],
    flow_opened: [
      { k: "2026-11-26", sys: "HC", type: "bug", n: 2 },
      { k: "2026-11-26", sys: "HK", type: "bug", n: 1 },
      { k: "2026-11-25", sys: "HC", type: "bug", n: 9 },
    ],
    done: [
      { code: "HC-9", title: "Fixed today", k: "2026-11-26", sys: "HC", type: "bug", priority: "medium", period: "now" },
      { code: "HC-8", title: "Fixed yesterday", k: "2026-11-25", sys: "HC", type: "bug", priority: "medium", period: "now" },
      { code: "HC-7", title: "Previous window", k: "2026-11-26", sys: "HC", type: "bug", period: "prev" },
    ],
  };
  const r = summariseTicketsToday(report, { today: "2026-11-26", overdueDays: 3, system: null, origin: O }, NOW);
  assert.equal(r.openedToday.total, 3);
  assert.deepEqual(r.openedToday.bySystem, { HC: 2, HK: 1 });
  assert.equal(r.openedToday.stillOpen, 1);
  assert.equal(r.openedToday.titles[0].code, "HC-1");
  assert.equal(r.openedToday.titles[0].url, `${O}/tickets/HC-1`);
  assert.equal(r.resolvedToday.total, 1);
  assert.equal(r.resolvedToday.titles[0].title, "Fixed today");
  assert.equal(r.openNow.total, 3);
  assert.deepEqual(r.openNow.byType, { bug: 2, development: 1 });
  assert.equal(r.urgent.total, 1);
  assert.equal(r.overdue.total, 1); // HK-2 (16 days); HC-3 is 2 days old
  assert.equal(r.overdue.tickets[0].code, "HK-2");
  assert.match(r.note, /no SLA target/);
  const hc = summariseTicketsToday(report, { today: "2026-11-26", overdueDays: 1, system: "HC", origin: O }, NOW);
  assert.equal(hc.openedToday.total, 2);
  assert.equal(hc.openNow.total, 2);
  assert.equal(hc.overdue.total, 1); // HC-3 at 2 days > 1
});

const listBody = {
  total: 3,
  tickets: [
    { code: "HC-1", title: "A", system_code: "HC", status: "open", priority: "low", created_at: "2026-10-01T00:00:00Z", assignee_name: null },
    { code: "HC-2", title: "B", system_code: "HC", status: "waiting_reporter", priority: "high", created_at: "2026-11-20T00:00:00Z", assignee_name: "Ann" },
    { code: "HK-3", title: "C", system_code: "HK", status: "open", priority: "high", created_at: "2026-11-26T00:00:00Z", assignee_name: "Ann" },
  ],
};

test("open_tickets counts, age buckets and olderThanDays", () => {
  const all = summariseTicketList(listBody, { olderThanDays: 0, origin: O, filters: { status: "active" } }, NOW);
  assert.equal(all.matching, 3);
  assert.deepEqual(all.byAge, { "0-2 days": 1, "3-7 days": 1, "8-30 days": 0, "over 30 days": 1 });
  assert.deepEqual(all.byAssignee, { Ann: 2, Unassigned: 1 });
  const old = summariseTicketList(listBody, { olderThanDays: 5, origin: O, filters: {} }, NOW);
  assert.equal(old.matching, 2);
  assert.equal(old.matchingAnyAge, 3);
  const partial = summariseTicketList({ ...listBody, total: 500 }, { olderThanDays: 0, origin: O, filters: {} }, NOW);
  assert.match(partial.note, /oldest 3 of 500/);
});

test("my_tickets puts high priority first", () => {
  const r = summariseMyTickets(listBody, O, NOW);
  assert.equal(r.assignedToMe, 3);
  assert.equal(r.tickets[0].code, "HC-2");
  assert.equal(r.tickets[1].code, "HK-3");
  assert.equal(r.waitingOnReporter, 1);
  assert.equal(r.openOver7Days, 1);
});

test("meetings_today: mine on the day + room bookings", () => {
  const mine = {
    meetings: [
      { id: 1, title: "Standup", start: "2026-11-26T01:00:00Z", end: "2026-11-26T01:30:00Z", status: "scheduled", attendees: ["a", "b"] },
      { id: 2, title: "Yesterday", start: "2026-11-25T01:00:00Z", end: "2026-11-25T02:00:00Z" },
    ],
  };
  const cal = {
    meetings: [
      { id: 1, title: "Standup", start: "2026-11-26T01:00:00Z", end: "2026-11-26T01:30:00Z", roomId: null },
      { id: 3, title: "Vendor", start: "2026-11-26T06:00:00Z", end: "2026-11-26T07:00:00Z", roomId: 4 },
    ],
  };
  const r = summariseMeetingsDay(mine, cal, "2026-11-26");
  assert.equal(r.myMeetings, 1);
  assert.equal(r.mine[0].time, "09:00-09:30");
  assert.equal(r.mine[0].attendees, 2);
  assert.equal(r.roomBookings, 1);
  assert.deepEqual(r.roomBookingsByRoom, { "room 4": 1 });
  assert.deepEqual(summariseMeetingsDay(null, null, "2026-11-26").myMeetings, 0);
});

test("daily_brief: each part answers or says it is unavailable", () => {
  const r = buildDailyBrief(
    {
      mine: { ok: true, value: listBody },
      unassignedHigh: { ok: true, value: { total: 1, tickets: [listBody.tickets[2]] } },
      meetings: { ok: false, message: "You do not have access to meetings in the hub." },
      notifications: { ok: true, value: { total: 2, notifications: [{ ticket_code: "HC-2", ticket_title: "B", kind: "comment", author_name: "Bob", created_at: "x" }] } },
    },
    "2026-11-26",
    O,
    NOW,
  );
  assert.equal(r.myOpenTickets.count, 3);
  assert.equal(r.myOpenTickets.highPriority, 2);
  assert.equal(r.myOpenTickets.top[0].code, "HC-2");
  assert.equal(r.unassignedHighPriority.count, 1);
  assert.deepEqual(r.myMeetingsToday, { unavailable: "You do not have access to meetings in the hub." });
  assert.equal(r.unreadNotifications.count, 2);
  assert.ok(JSON.stringify(r).length < 30_000);
});

test("export helpers: columns, date range, file name", () => {
  assert.deepEqual(pickColumns(TICKET_EXPORT_COLUMNS, ["Title", "code", "nope"]).map((c) => c.key), ["code", "title"]);
  assert.equal(pickColumns(TICKET_EXPORT_COLUMNS, ["nope"]).length, TICKET_EXPORT_COLUMNS.length);
  assert.equal(pickColumns(TICKET_EXPORT_COLUMNS, undefined).length, TICKET_EXPORT_COLUMNS.length);
  const row = { created_at: "2026-11-25T17:00:00Z" }; // 26 Nov in Malaysia
  assert.ok(inCreatedRange(row, "2026-11-26", "2026-11-26"));
  assert.ok(!inCreatedRange(row, "2026-11-27", ""));
  assert.ok(!inCreatedRange(row, "", "2026-11-25"));
  assert.equal(exportFileName("tickets", "2026-11-26"), "hub-tickets-2026-11-26.xlsx");
});

test("rate limit: 30 a minute, 600 a day", () => {
  assert.deepEqual(RATE_LIMITS, { perMinute: 30, perDay: 600 });
  assert.equal(rateLimitMessage({ minute: 29, day: 100 }), null);
  assert.match(rateLimitMessage({ minute: 30, day: 100 }), /Too many requests — wait a minute/);
  assert.match(rateLimitMessage({ minute: 0, day: 600 }), /Daily limit reached/);
  assert.match(rateLimitMessage({ minute: 30, day: 600 }), /Daily limit reached/);
});

test("daily-brief prompt", () => {
  assert.equal(DAILY_BRIEF_PROMPT.name, "daily-brief");
  assert.match(DAILY_BRIEF_TEXT, /daily_brief/);
});

// ── xlsx ────────────────────────────────────────────────────────────────────

/** Read a zip back: name → bytes (stored or deflated), checking each CRC. */
function unzip(buf) {
  const b = Buffer.from(buf);
  const out = new Map();
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50);
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const csize = b.readUInt32LE(p + 20);
    const nlen = b.readUInt16LE(p + 28);
    const off = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = b.readUInt16LE(off + 26);
    const data = b.subarray(off + 30 + lnlen, off + 30 + lnlen + csize);
    const raw = method === 8 ? inflateRawSync(data) : data;
    assert.equal(crc32(new Uint8Array(raw)), crc, `crc of ${name}`);
    out.set(name, raw.toString("utf8"));
    p += 46 + nlen;
  }
  return out;
}

test("xlsx helpers", () => {
  assert.equal(colName(0), "A");
  assert.equal(colName(25), "Z");
  assert.equal(colName(26), "AA");
  assert.equal(colName(701), "ZZ");
  assert.equal(xmlEscape('a<b>&"c"\u0001'), "a&lt;b&gt;&amp;&quot;c&quot;");
  assert.equal(myDateTime("2026-11-25T17:05:00Z"), "2026-11-26 01:05");
  assert.equal(myDateTime("2026-11-25"), "2026-11-25");
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("xlsx: a real workbook with header, money, dates and widths", async () => {
  const cols = [
    { key: "code", header: "Code" },
    { key: "amount", header: "Amount (RM)", kind: "money" },
    { key: "n", header: "Qty", kind: "number" },
    { key: "at", header: "When", kind: "date" },
  ];
  const rows = [
    { code: "HC-1 <x> & y", amount: 1234.5, n: 3, at: "2026-11-25T17:05:00Z" },
    { code: "HC-2", amount: null, n: "not a number", at: "" },
  ];
  for (const compress of [true, false]) {
    const bytes = await buildXlsx("Tickets", cols, rows, compress);
    const files = unzip(bytes);
    assert.deepEqual([...files.keys()].sort(), ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    const sheet = files.get("xl/worksheets/sheet1.xml");
    assert.match(sheet, /<c r="A1" t="inlineStr" s="1"><is><t>Code<\/t>/);
    assert.match(sheet, /<c r="B2" s="2"><v>1234.5<\/v><\/c>/);
    assert.match(sheet, /<c r="C2"><v>3<\/v><\/c>/);
    assert.match(sheet, /HC-1 &lt;x&gt; &amp; y/);
    assert.match(sheet, /2026-11-26 01:05/);
    assert.match(sheet, /<c r="C3" t="inlineStr"><is><t xml:space="preserve">not a number/);
    assert.match(sheet, /<dimension ref="A1:D3"\/>/);
    assert.match(sheet, /state="frozen"/);
    assert.match(files.get("xl/workbook.xml"), /<sheet name="Tickets"/);
  }
});

test("xlsx: 5,000 rows stay small", async () => {
  const cols = [{ key: "code", header: "Code" }, { key: "title", header: "Title" }, { key: "at", header: "Created", kind: "date" }];
  const rows = Array.from({ length: 5000 }, (_, i) => ({ code: `HC-${i}`, title: `Ticket number ${i} about a printer`, at: "2026-11-25T17:05:00Z" }));
  const bytes = await buildXlsx("Tickets", cols, rows);
  assert.ok(bytes.length < 400_000, `size ${bytes.length}`);
  assert.equal((unzip(bytes).get("xl/worksheets/sheet1.xml").match(/<row /g) ?? []).length, 5001);
});
