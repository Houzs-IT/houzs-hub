// ---------------------------------------------------------------------------
// mcp-round3.ts — AI Connector round 3 (owner 2026-11-26): tickets_today,
// open_tickets, my_tickets, meetings_today, daily_brief, export_excel columns,
// the daily-brief prompt and the per-person rate limit.
//
// Same rule as mcp-quick.ts: pure functions over what the hub's own endpoints
// return AS the person (routes/mcp.ts reads them through the in-process GET, so
// need("it") and every other route check still decide). Nothing here decides who
// may see what. No imports, so `node --test` loads it directly
// (backend/test/mcp-round3.test.mjs).
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const s = (v: unknown): string => (v === undefined || v === null ? "" : v instanceof Date ? v.toISOString() : String(v));
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const DAY_MS = 86_400_000;
const MY_MS = 8 * 3600_000;

const ageDays = (createdAt: unknown, nowMs: number): number => {
  const t = Date.parse(s(createdAt));
  return Number.isFinite(t) ? Math.floor((nowMs - t) / DAY_MS) : 0;
};

/** The Malaysia calendar day (YYYY-MM-DD) of an instant. */
export function myDay(v: unknown): string {
  const t = Date.parse(s(v));
  return Number.isFinite(t) ? new Date(t + MY_MS).toISOString().slice(0, 10) : "";
}

const tally = (rows: Obj[], key: (r: Obj) => string, weight: (r: Obj) => number = () => 1): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r) || "(none)";
    m[k] = (m[k] ?? 0) + weight(r);
  }
  return Object.fromEntries(Object.entries(m).sort((x, y) => y[1] - x[1]));
};

const ticketUrl = (origin: string, code: string) => `${origin}/tickets/${encodeURIComponent(code)}`;

// ── filters ─────────────────────────────────────────────────────────────────

/** Statuses the tickets list accepts in its comma list (routes/dev.ts filterWhere). */
export const TICKET_STATUS_FILTERS = ["active", "all", "open", "in_progress", "on_hold", "testing", "waiting_reporter", "resolved", "closed", "rejected"];
export const TICKET_PRIORITY_FILTERS = ["high", "medium", "low"];
export const TICKET_TYPE_FILTERS = ["bug", "development"];

/** Keep a comma list to known values; "" when nothing valid is left. */
export function cleanList(v: unknown, allowed: string[]): string {
  return s(v)
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => allowed.includes(x))
    .join(",");
}

/** A system code list (letters / digits), upper-cased. */
export function cleanSystems(v: unknown): string {
  return s(v)
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter((x) => /^[A-Z0-9]{1,12}$/.test(x))
    .join(",");
}

/** A whole number of days in 0..365 (default when missing / invalid). */
export function dayCount(v: unknown, def: number): number {
  if (v === undefined || v === null || v === "") return def;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(365, Math.max(0, n)) : def;
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const byUrgency = (x: Obj, y: Obj) => (PRIORITY_ORDER[s(x.priority)] ?? 3) - (PRIORITY_ORDER[s(y.priority)] ?? 3) || cmp(s(x.created_at), s(y.created_at));

/** One ticket row of GET /api/v1/dev/tickets, short. */
const listTicket = (t: Obj, nowMs: number, origin: string) => ({
  code: s(t.code),
  title: s(t.title).slice(0, 120),
  system: s(t.system_code),
  type: s(t.type),
  status: s(t.status),
  priority: s(t.priority),
  assignee: s(t.assignee_name) || null,
  reporter: s(t.reporter_name) || null,
  ageDays: ageDays(t.created_at, nowMs),
  url: ticketUrl(origin, s(t.code)),
});

// ── tickets_today ───────────────────────────────────────────────────────────

/** Open longer than this (days) counts as overdue: the hub keeps no SLA target or due date. */
export const OVERDUE_DAYS_DEFAULT = 3;

/**
 * tickets_today from GET /api/v1/dev/tickets/report?range=this (the Reports
 * page's own query): opened today (flow_opened, by system and type), resolved
 * today (done rows of today), still open now (open_tickets), the urgent ones
 * (high priority) and the overdue ones (open longer than overdueDays).
 * Category = the ticket's type (bug / development) and its module.
 */
export function summariseTicketsToday(report: unknown, opts: { today: string; overdueDays: number; system: string | null; origin: string }, nowMs: number = Date.now()) {
  const r = obj(report);
  const sysOk = (row: Obj) => !opts.system || s(row.sys) === opts.system;
  const open = arr(r.open_tickets).filter(sysOk);
  const openedFlow = arr(r.flow_opened).filter((x) => sysOk(x) && s(x.k) === opts.today);
  const doneToday = arr(r.done).filter((x) => sysOk(x) && s(x.period) === "now" && s(x.k) === opts.today);
  const openedTodayOpen = open.filter((t) => myDay(t.created_at) === opts.today);
  const brief = (t: Obj) => ({
    code: s(t.code),
    title: s(t.title).slice(0, 120),
    system: s(t.sys),
    type: s(t.type),
    module: s(t.module) || null,
    status: s(t.status) || null,
    priority: s(t.priority),
    assignee: s(t.assignee) || null,
    ageDays: t.created_at ? ageDays(t.created_at, nowMs) : undefined,
    url: ticketUrl(opts.origin, s(t.code)),
  });
  const urgent = open.filter((t) => s(t.priority) === "high").sort((a, b) => cmp(s(a.created_at), s(b.created_at)));
  const overdue = open.filter((t) => ageDays(t.created_at, nowMs) > opts.overdueDays).sort((a, b) => cmp(s(a.created_at), s(b.created_at)));
  const openedTotal = openedFlow.reduce((n, x) => n + num(x.n), 0);
  return {
    day: opts.today,
    ...(opts.system ? { system: opts.system } : {}),
    openedToday: {
      total: openedTotal,
      bySystem: tally(openedFlow, (x) => s(x.sys), (x) => num(x.n)),
      byType: tally(openedFlow, (x) => s(x.type), (x) => num(x.n)),
      stillOpen: openedTodayOpen.length,
      titles: openedTodayOpen.slice(0, 15).map(brief),
    },
    resolvedToday: {
      total: doneToday.length,
      bySystem: tally(doneToday, (x) => s(x.sys)),
      byType: tally(doneToday, (x) => s(x.type)),
      titles: doneToday.slice(0, 15).map(brief),
    },
    openNow: {
      total: open.length,
      bySystem: tally(open, (t) => s(t.sys)),
      byType: tally(open, (t) => s(t.type)),
      byModule: Object.fromEntries(Object.entries(tally(open, (t) => s(t.module))).slice(0, 15)),
      byStatus: tally(open, (t) => s(t.status)),
    },
    urgent: { total: urgent.length, tickets: urgent.slice(0, 15).map(brief) },
    overdue: { olderThanDays: opts.overdueDays, total: overdue.length, tickets: overdue.slice(0, 15).map(brief) },
    note: `Days are Malaysia time. Urgent = high priority. The hub keeps no SLA target or due date, so overdue = open more than ${opts.overdueDays} days. Category = type (bug / development) and module. "Opened today" counts every ticket raised today; the titles list those still open.`,
  };
}

// ── open_tickets / my_tickets ───────────────────────────────────────────────

/** Age buckets an open ticket falls into (days since it was raised). */
export const AGE_BUCKETS = [
  { label: "0-2 days", max: 2 },
  { label: "3-7 days", max: 7 },
  { label: "8-30 days", max: 30 },
  { label: "over 30 days", max: Infinity },
];

/**
 * open_tickets from GET /api/v1/dev/tickets (oldest first, one page of up to
 * 200). `total` is the list's own count of every match; breakdowns cover the
 * rows read, and the reply says when that is fewer than the total.
 */
export function summariseTicketList(body: unknown, opts: { olderThanDays: number; origin: string; filters: Obj }, nowMs: number = Date.now()) {
  const b = obj(body);
  const rows = arr(b.tickets);
  const total = num(b.total);
  const aged = rows.filter((t) => ageDays(t.created_at, nowMs) >= opts.olderThanDays);
  const byAge: Record<string, number> = Object.fromEntries(AGE_BUCKETS.map((a) => [a.label, 0]));
  for (const t of aged) {
    const d = ageDays(t.created_at, nowMs);
    byAge[(AGE_BUCKETS.find((a) => d <= a.max) ?? AGE_BUCKETS[AGE_BUCKETS.length - 1]).label]++;
  }
  return {
    filters: opts.filters,
    matching: opts.olderThanDays > 0 ? aged.length : total,
    ...(opts.olderThanDays > 0 ? { olderThanDays: opts.olderThanDays, matchingAnyAge: total } : {}),
    ...(rows.length < total ? { note: `Counted from the oldest ${rows.length} of ${total} matching tickets.` } : {}),
    byStatus: tally(aged, (t) => s(t.status)),
    byPriority: tally(aged, (t) => s(t.priority)),
    bySystem: tally(aged, (t) => s(t.system_code)),
    byAge,
    byAssignee: Object.fromEntries(Object.entries(tally(aged, (t) => s(t.assignee_name) || "Unassigned")).slice(0, 20)),
    oldest: aged.slice(0, 10).map((t) => listTicket(t, nowMs, opts.origin)),
    sla: "The hub keeps no SLA target or due date on tickets: use olderThanDays for 'overdue'.",
  };
}

/** my_tickets from GET /api/v1/dev/tickets?assignee=me&status=active. */
export function summariseMyTickets(body: unknown, origin: string, nowMs: number = Date.now()) {
  const b = obj(body);
  const rows = arr(b.tickets);
  const total = num(b.total) || rows.length;
  return {
    assignedToMe: total,
    byStatus: tally(rows, (t) => s(t.status)),
    byPriority: tally(rows, (t) => s(t.priority)),
    waitingOnReporter: rows.filter((t) => s(t.status) === "waiting_reporter").length,
    openOver7Days: rows.filter((t) => ageDays(t.created_at, nowMs) > 7).length,
    tickets: [...rows].sort(byUrgency).slice(0, 30).map((t) => listTicket(t, nowMs, origin)),
    ...(rows.length < total ? { note: `Listing ${rows.length} of ${total}.` } : {}),
  };
}

// ── meetings_today ──────────────────────────────────────────────────────────

/** Malaysia day [start, end) as ISO instants for a YYYY-MM-DD. */
export function myDayRange(day: string): { from: string; to: string } {
  const start = Date.parse(`${day}T00:00:00+08:00`);
  return { from: new Date(start).toISOString(), to: new Date(start + DAY_MS).toISOString() };
}

const hhmm = (iso: unknown): string => {
  const t = Date.parse(s(iso));
  return Number.isFinite(t) ? new Date(t + MY_MS).toISOString().slice(11, 16) : "";
};

const briefMeeting = (m: Obj) => ({
  id: num(m.id),
  title: s(m.title).slice(0, 120),
  time: `${hhmm(m.start)}-${hhmm(m.end)}`,
  status: s(m.status),
  roomId: m.roomId ?? null,
  organizer: s(m.organizer) || null,
  attendees: Array.isArray(m.attendees) ? (m.attendees as unknown[]).length : 0,
  video: obj(m.video).url ? "yes" : "no",
});

const onDay = (m: Obj, r: { from: string; to: string }) => s(m.start) < r.to && s(m.end) > r.from;

/**
 * meetings_today from GET /api/v1/meetings/mine (the person's meetings, from a
 * day ago on) and GET /api/v1/meetings/calendar (everything they may see that
 * day; room bookings are visible to everyone). Neither reply carries room
 * names, so rooms show by id.
 */
export function summariseMeetingsDay(mine: unknown, calendar: unknown, day: string) {
  const r = myDayRange(day);
  const my = arr(obj(mine).meetings).filter((m) => onDay(m, r)).sort((a, b) => cmp(s(a.start), s(b.start)));
  const rooms = arr(obj(calendar).meetings)
    .filter((m) => onDay(m, r) && m.roomId !== null && m.roomId !== undefined)
    .sort((a, b) => cmp(s(a.start), s(b.start)));
  return {
    day,
    myMeetings: my.length,
    mine: my.slice(0, 20).map(briefMeeting),
    roomBookings: rooms.length,
    roomBookingsByRoom: tally(rooms, (m) => `room ${s(m.roomId)}`),
    rooms: rooms.slice(0, 30).map(briefMeeting),
    note: "Times are Malaysia time. Rooms show by id (room names are on the Meetings page).",
  };
}

// ── daily brief ─────────────────────────────────────────────────────────────

export type BriefPart = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * daily_brief: what is the person's own today. Each part is one read as the
 * person; a part they may not read says so and the rest still answer.
 */
export function buildDailyBrief(
  parts: { mine: BriefPart; unassignedHigh: BriefPart; meetings: BriefPart; notifications: BriefPart },
  day: string,
  origin: string,
  nowMs: number = Date.now(),
) {
  const section = <T,>(p: BriefPart, f: (v: unknown) => T): T | { unavailable: string } => (p.ok ? f(p.value) : { unavailable: p.message });
  const top5 = (rows: Obj[]) => rows.slice(0, 5).map((t) => listTicket(t, nowMs, origin));
  const r = myDayRange(day);
  return {
    day,
    myOpenTickets: section(parts.mine, (v) => {
      const rows = arr(obj(v).tickets);
      return {
        count: num(obj(v).total) || rows.length,
        highPriority: rows.filter((t) => s(t.priority) === "high").length,
        waitingOnReporter: rows.filter((t) => s(t.status) === "waiting_reporter").length,
        openOver7Days: rows.filter((t) => ageDays(t.created_at, nowMs) > 7).length,
        top: top5([...rows].sort(byUrgency)),
      };
    }),
    unassignedHighPriority: section(parts.unassignedHigh, (v) => ({ count: num(obj(v).total) || arr(obj(v).tickets).length, top: top5(arr(obj(v).tickets)) })),
    myMeetingsToday: section(parts.meetings, (v) => {
      const ms = arr(obj(v).meetings)
        .filter((m) => onDay(m, r))
        .sort((a, b) => cmp(s(a.start), s(b.start)));
      return { count: ms.length, top: ms.slice(0, 5).map(briefMeeting) };
    }),
    unreadNotifications: section(parts.notifications, (v) => {
      const rows = arr(obj(v).notifications);
      return {
        count: num(obj(v).total) || rows.length,
        top: rows.slice(0, 5).map((n) => ({ ticket: s(n.ticket_code), title: s(n.ticket_title).slice(0, 100), what: s(n.kind), by: s(n.author_name), at: s(n.created_at) })),
      };
    }),
    note: "The hub keeps no due date on tickets: 'open over 7 days' stands in for overdue. Ticket codes open with fetch.",
  };
}

// ── export_excel ────────────────────────────────────────────────────────────

export const EXPORT_ROW_CAP = 5000;

export type ExportColumn = { key: string; header: string; kind?: "text" | "number" | "money" | "date" };

/** The ticket list's columns (GET /api/v1/dev/tickets rows), in sheet order. */
export const TICKET_EXPORT_COLUMNS: ExportColumn[] = [
  { key: "code", header: "Code" },
  { key: "system_code", header: "System" },
  { key: "title", header: "Title" },
  { key: "type", header: "Type" },
  { key: "priority", header: "Priority" },
  { key: "status", header: "Status" },
  { key: "assignee_name", header: "Assignee" },
  { key: "reporter_name", header: "Reporter" },
  { key: "reporter_department", header: "Reporter department" },
  { key: "created_at", header: "Created (MYT)", kind: "date" },
  { key: "updated_at", header: "Updated (MYT)", kind: "date" },
  { key: "legacy_code", header: "Legacy code" },
];

/** The chosen columns (by key or header, any case), in sheet order; all of them when none match. */
export function pickColumns(all: ExportColumn[], fields: unknown): ExportColumn[] {
  const want = Array.isArray(fields) ? (fields as unknown[]).map((f) => s(f).trim().toLowerCase()).filter(Boolean) : [];
  if (!want.length) return all;
  const picked = all.filter((c) => want.includes(c.key.toLowerCase()) || want.includes(c.header.toLowerCase()));
  return picked.length ? picked : all;
}

/** Rows created inside from..to (Malaysia days, inclusive); empty bounds = open. */
export function inCreatedRange(row: Obj, from: string, to: string): boolean {
  const day = myDay(row.created_at);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/** A file name for the export: hub-tickets-2026-11-26.xlsx */
export function exportFileName(list: string, day: string): string {
  return `hub-${list.replace(/[^a-z0-9-]/gi, "")}-${day}.xlsx`;
}

// ── rate limit ──────────────────────────────────────────────────────────────

export const RATE_LIMITS = { perMinute: 30, perDay: 600 };

/** The refusal for a person over their limit, or null. Counts are tool calls already made. */
export function rateLimitMessage(counts: { minute: number; day: number }, limits = RATE_LIMITS): string | null {
  if (counts.day >= limits.perDay) return `Daily limit reached: ${limits.perDay} AI Connector lookups in 24 hours. Try again later.`;
  if (counts.minute >= limits.perMinute) return `Too many requests — wait a minute (limit ${limits.perMinute} lookups a minute).`;
  return null;
}

// ── the daily-brief prompt ──────────────────────────────────────────────────

export const DAILY_BRIEF_PROMPT = {
  name: "daily-brief",
  title: "What do I need to look at today?",
  description: "Your open tickets (high priority and the oldest first), unassigned high-priority tickets, your meetings today and unread notifications.",
  arguments: [] as { name: string; description: string; required: boolean }[],
};

export const DAILY_BRIEF_TEXT =
  "What do I need to look at today? Use daily_brief. Start with anything of mine that is high priority or open more than 7 days, then unassigned high-priority tickets, my meetings today (with times) and unread notifications. Give ticket codes with links. If a part says I do not have access, say so in one line.";
