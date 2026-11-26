// ---------------------------------------------------------------------------
// mcp-round4.ts — AI Connector round 4 (owner 2026-11-26): tickets_overdue,
// ticket_digest, data_gaps and the shared `period` convention.
//
// Same rule as mcp-quick.ts / mcp-round3.ts: every number comes from the hub's
// own endpoints read AS the person through `read` (routes/mcp.ts passes its
// in-process GET, so need("it"), need("billing_view", ...) and every other route
// check decide). Nothing here decides who may see what: a refused read becomes
// "You do not have access to X in the hub." and carries no data.
// No imports, so `node --test` loads it directly (backend/test/mcp-round4.test.mjs).
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const s = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const DAY_MS = 86_400_000;
const MY_MS = 8 * 3600_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const tally = (rows: Obj[], key: (r: Obj) => string): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r) || "(none)";
    m[k] = (m[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(m).sort((x, y) => y[1] - x[1]));
};

const ticketUrl = (origin: string, code: string) => `${origin}/tickets/${encodeURIComponent(code)}`;
const myDay = (v: unknown): string => {
  const t = Date.parse(s(v));
  return Number.isFinite(t) ? new Date(t + MY_MS).toISOString().slice(0, 10) : "";
};

/** Cut text to n characters on a word boundary where one is near, with an ellipsis. */
export function trimText(v: unknown, n: number): string {
  const t = s(v).replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

// ── period convention ───────────────────────────────────────────────────────
// Every period-type tool takes `period`: today | week | month | last_month |
// quarter | year | custom (custom needs from / to). Days are Malaysia time,
// inclusive. "week" starts on Monday. The previous period is the same span one
// unit earlier (yesterday, last week to the same weekday, last month to the same
// day, ...); for custom, the same number of days straight before.

export const PERIODS = ["today", "week", "month", "last_month", "quarter", "year", "custom"] as const;
export type Period = (typeof PERIODS)[number];
export const MAX_CUSTOM_DAYS = 366;

export type Span = { from: string; to: string; days: number; start: string; end: string };
export type PeriodWindow = { period: Period; current: Span; previous: Span };

const ymdMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const ymdOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => ymdOf(ymdMs(d) + n * DAY_MS);
const lastDayOf = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
/** Shift a YYYY-MM-DD by whole months, clamping the day to the month's end (31 Mar - 1 month = 28/29 Feb). */
export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const yy = t.getUTCFullYear();
  const mm = t.getUTCMonth();
  return ymdOf(Date.UTC(yy, mm, Math.min(day, lastDayOf(yy, mm))));
}

/** One Malaysia-day span as ISO instants [start, end). */
export function span(from: string, to: string): Span {
  return {
    from,
    to,
    days: Math.round((ymdMs(to) - ymdMs(from)) / DAY_MS) + 1,
    start: new Date(Date.parse(`${from}T00:00:00+08:00`)).toISOString(),
    end: new Date(Date.parse(`${addDays(to, 1)}T00:00:00+08:00`)).toISOString(),
  };
}

/** The current and previous window of a period, or an error for the person. */
export function periodWindow(periodRaw: unknown, fromRaw: unknown, toRaw: unknown, today: string, def: Period = "month"): PeriodWindow | { error: string } {
  const p0 = s(periodRaw).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const fromIn = s(fromRaw).trim();
  const toIn = s(toRaw).trim();
  const period: Period = p0 ? ((PERIODS as readonly string[]).includes(p0) ? (p0 as Period) : ("" as Period)) : fromIn || toIn ? "custom" : def;
  if (!period) return { error: `Unknown period. Use one of: ${PERIODS.join(", ")} (custom needs from and to as YYYY-MM-DD).` };
  const [y, m] = today.split("-").map(Number);
  let from = today;
  let to = today;
  let prevFrom: string;
  let prevTo: string;
  switch (period) {
    case "today":
      prevFrom = prevTo = addDays(today, -1);
      break;
    case "week": {
      const dow = (new Date(ymdMs(today)).getUTCDay() + 6) % 7; // Monday = 0
      from = addDays(today, -dow);
      prevFrom = addDays(from, -7);
      prevTo = addDays(today, -7);
      break;
    }
    case "month":
      from = `${today.slice(0, 7)}-01`;
      prevFrom = addMonths(from, -1);
      prevTo = addMonths(today, -1);
      break;
    case "last_month":
      from = addMonths(`${today.slice(0, 7)}-01`, -1);
      to = ymdOf(Date.UTC(y, m - 1, 0));
      prevFrom = addMonths(from, -1);
      prevTo = ymdOf(Date.UTC(y, m - 2, 0));
      break;
    case "quarter": {
      const q0 = Math.floor((m - 1) / 3) * 3;
      from = ymdOf(Date.UTC(y, q0, 1));
      prevFrom = addMonths(from, -3);
      prevTo = addMonths(today, -3);
      break;
    }
    case "year":
      from = `${y}-01-01`;
      prevFrom = `${y - 1}-01-01`;
      prevTo = addMonths(today, -12);
      break;
    case "custom": {
      if (!YMD.test(fromIn) || !YMD.test(toIn) || !Number.isFinite(ymdMs(fromIn)) || !Number.isFinite(ymdMs(toIn))) {
        return { error: "A custom period needs from and to as YYYY-MM-DD." };
      }
      if (fromIn > toIn) return { error: "from must be on or before to." };
      from = fromIn;
      to = toIn;
      const days = Math.round((ymdMs(to) - ymdMs(from)) / DAY_MS) + 1;
      if (days > MAX_CUSTOM_DAYS) return { error: `A custom period is at most ${MAX_CUSTOM_DAYS} days.` };
      prevTo = addDays(from, -1);
      prevFrom = addDays(from, -days);
      break;
    }
  }
  return { period, current: span(from, to), previous: span(prevFrom!, prevTo!) };
}

// ── reading as the person ───────────────────────────────────────────────────

/** One read as the person (routes/mcp.ts readValue). A 401 / 403 is the hub's own refusal. */
export type ReadResult = { ok: true; value: unknown } | { ok: false; status: number; message: string; note?: string };
export type Read = (path: string, query?: Record<string, unknown>) => Promise<ReadResult>;
export type ToolDeps = { read: Read; origin: string; today: string; nowMs: number };
export type ToolOutcome =
  | { ok: true; body: unknown; target: string }
  | { ok: false; status: number; message: string; note: string; target: string };

const refused = (r: ReadResult): boolean => !r.ok && (r.status === 401 || r.status === 403);
export const noAccess = (what: string) => `You do not have access to ${what} in the hub.`;
const fail = (r: Extract<ReadResult, { ok: false }>, what: string, target: string): ToolOutcome =>
  refused(r)
    ? { ok: false, status: r.status, message: noAccess(what), note: "no permission", target }
    : { ok: false, status: r.status, message: r.message, note: r.note ?? "", target };

type Section<T> = T | { unavailable: string };
const section = <T,>(r: ReadResult, what: string, f: (v: unknown) => T): Section<T> =>
  r.ok ? f(r.value) : { unavailable: refused(r) ? noAccess(what) : r.message };

/** Endpoints each round-4 tool reads (the PR's permission table; the tests hold the tools to it). */
export const ROUND4_ENDPOINTS: Record<string, string[]> = {
  tickets_overdue: ["/api/v1/dev/tickets/report"],
  ticket_digest: ["/api/v1/dev/tickets/digest"],
  data_gaps: ["/api/v1/dev/tickets/report", "/api/v1/dev/billing", "/api/v1/dev/accounts"],
};

const cleanSystemList = (v: unknown): string =>
  s(v)
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter((x) => /^[A-Z0-9]{1,12}$/.test(x))
    .join(",");

// ── tickets_overdue ─────────────────────────────────────────────────────────

/**
 * The Reports page's SLA targets in hours, per priority, from submitted to done,
 * not counting time in Waiting Reporter (frontend/src/lib/labels.ts SLA_HOURS;
 * the test fails if the two drift apart).
 */
export const SLA_HOURS: Record<string, number> = { high: 24, medium: 72, low: 168 };

/**
 * tickets_overdue from GET /api/v1/dev/tickets/report (open_tickets): past SLA
 * exactly as the Reports page's "Past SLA" tile counts it (imported tickets
 * never count), plus every high-priority ticket nobody is assigned to.
 */
export function summariseOverdue(report: unknown, opts: { systems: string[]; origin: string }, nowMs: number) {
  const sysOk = (t: Obj) => !opts.systems.length || opts.systems.includes(s(t.sys));
  const open = arr(obj(report).open_tickets).filter(sysOk);
  const used = (t: Obj) => (nowMs - Date.parse(s(t.created_at))) / 3_600_000 - num(t.waiting_hours);
  const target = (t: Obj) => SLA_HOURS[s(t.priority)] ?? SLA_HOURS.low;
  const past = open.filter((t) => !t.legacy && Number.isFinite(Date.parse(s(t.created_at))) && used(t) > target(t));
  const row = (t: Obj) => ({
    code: s(t.code),
    title: s(t.title).slice(0, 120),
    system: s(t.sys),
    module: s(t.module) || null,
    priority: s(t.priority),
    status: s(t.status),
    assignee: s(t.assignee) || null,
    raised: myDay(t.created_at),
    slaHours: target(t),
    hoursUsed: Math.round(used(t)),
    hoursOver: Math.round(used(t) - target(t)),
    url: ticketUrl(opts.origin, s(t.code)),
  });
  const pastRows = past.map(row).sort((a, b) => b.hoursOver - a.hoursOver);
  const urgent = open
    .filter((t) => s(t.priority) === "high" && (t.assignee_id === null || t.assignee_id === undefined))
    .sort((a, b) => cmp(s(a.created_at), s(b.created_at)))
    .map(row);
  return {
    asOf: new Date(nowMs).toISOString(),
    ...(opts.systems.length ? { systems: opts.systems } : {}),
    openTickets: open.length,
    pastSla: {
      total: past.length,
      bySystem: tally(past, (t) => s(t.sys)),
      byAssignee: tally(past, (t) => s(t.assignee) || "Unassigned"),
      byPriority: tally(past, (t) => s(t.priority)),
      tickets: pastRows.slice(0, 25),
    },
    urgentUnassigned: { total: urgent.length, bySystem: tally(urgent.map((u) => ({ sys: u.system })), (t) => s(t.sys)), tickets: urgent.slice(0, 25) },
    slaTargetsHours: SLA_HOURS,
    note: "Past SLA is the Reports page's rule: hours since submitted, minus time in Waiting Reporter, over the priority's target (high 24 h, medium 3 d, low 7 d). Tickets imported from the old sheet never count. Urgent = high priority.",
  };
}

// ── ticket_digest ───────────────────────────────────────────────────────────

export const DIGEST_DEFAULT_LIMIT = 40;
export const DIGEST_MAX_LIMIT = 100;
export const DIGEST_SUMMARY_CHARS = 200;
export const DIGEST_COMMENT_CHARS = 200;

/** ticket_digest from GET /api/v1/dev/tickets/digest: grouped by system, short summaries. */
export function summariseDigest(body: unknown, prevBody: unknown | null, w: PeriodWindow, origin: string) {
  const b = obj(body);
  const rows = arr(b.tickets);
  const total = num(b.total);
  const groups = new Map<string, { system: string; name: string; tickets: Obj[] }>();
  for (const t of rows) {
    const code = s(t.system_code);
    const g = groups.get(code) ?? { system: code, name: s(t.system_name) || code, tickets: [] };
    g.tickets.push(t);
    groups.set(code, g);
  }
  const prevTotal = prevBody === null ? null : num(obj(prevBody).total);
  return {
    period: w.period,
    from: w.current.from,
    to: w.current.to,
    raised: total,
    ...(prevTotal === null ? {} : { previousPeriod: { from: w.previous.from, to: w.previous.to, raised: prevTotal, change: total - prevTotal } }),
    shown: rows.length,
    ...(rows.length < total ? { note: `Showing the newest ${rows.length} of ${total}; narrow by system or a shorter period for the rest.` } : {}),
    bySystem: [...groups.values()]
      .sort((x, y) => y.tickets.length - x.tickets.length || cmp(x.system, y.system))
      .map((g) => ({
        system: g.system,
        name: g.name,
        count: g.tickets.length,
        tickets: g.tickets.map((t) => {
          const lc = obj(t.latest_comment);
          return {
            code: s(t.code),
            title: s(t.title).slice(0, 140),
            status: s(t.status),
            priority: s(t.priority),
            type: s(t.type),
            module: s(t.module) || null,
            reporter: s(t.reporter_name) || null,
            assignee: s(t.assignee_name) || null,
            raised: myDay(t.created_at),
            summary: trimText(t.description, DIGEST_SUMMARY_CHARS),
            latestComment: lc.body
              ? { by: s(lc.author_name), at: myDay(lc.created_at), ...(s(lc.visibility) === "internal" ? { internal: true } : {}), text: trimText(lc.body, DIGEST_COMMENT_CHARS) }
              : null,
            url: ticketUrl(origin, s(t.code)),
          };
        }),
      })),
    guide: "Tickets raised in the period, newest first, grouped by system. summary = the start of what was reported; latestComment = the newest comment (internal ones are marked). Open a ticket in full with fetch {id: code}.",
  };
}

// ── data_gaps ───────────────────────────────────────────────────────────────

const ACTIVE_CHARGE = (r: Obj) => !["not_active", "cancelled"].includes(s(r.status));

/**
 * data_gaps: records missing something the hub's own pages expect. Each part is
 * one read as the person; a part they may not read says so and the rest answer.
 *   tickets  (report, needs "it"): open tickets with no assignee / no module.
 *   billing  (needs billing_view): active charges with no amount, card, system or account, or never checked.
 *   accounts (needs accounts_view): accounts with no main owner, no IT access, no bills-to.
 */
export function buildDataGaps(parts: { report: ReadResult; billing: ReadResult; accounts: ReadResult }, opts: { systems: string[]; origin: string }) {
  const list = <T,>(rows: T[]) => ({ total: rows.length, items: rows.slice(0, 15) });
  const tickets = section(parts.report, "IT tickets", (v) => {
    const open = arr(obj(v).open_tickets).filter((t) => !opts.systems.length || opts.systems.includes(s(t.sys)));
    const brief = (t: Obj) => ({ code: s(t.code), title: s(t.title).slice(0, 100), system: s(t.sys), priority: s(t.priority), status: s(t.status), url: ticketUrl(opts.origin, s(t.code)) });
    const noAssignee = open.filter((t) => t.assignee_id === null || t.assignee_id === undefined);
    const noModule = open.filter((t) => !s(t.module));
    return {
      openTickets: open.length,
      noAssignee: { ...list(noAssignee.map(brief)), bySystem: tally(noAssignee, (t) => s(t.sys)) },
      noModule: { ...list(noModule.map(brief)), bySystem: tally(noModule, (t) => s(t.sys)) },
      noSystem: { total: 0, note: "Every ticket has a system: it is required when a ticket is raised." },
    };
  });
  const billing = section(parts.billing, "system billing", (v) => {
    const charges = arr(obj(v).charges).filter(ACTIVE_CHARGE);
    const brief = (r: Obj) => ({ id: num(r.id), registerId: s(r.registerId) || null, vendor: s(r.vendor), plan: s(r.plan) || null, company: s(r.company) || null, status: s(r.status) });
    const noSystem = (r: Obj) => !s(r.systemCode) && !arr(r.splits).length && !num(r.splitByUsage);
    return {
      activeCharges: charges.length,
      noAmount: list(charges.filter((r) => r.amount === null || r.amount === undefined).map(brief)),
      noCard: list(charges.filter((r) => !s(r.card)).map(brief)),
      noSystem: list(charges.filter(noSystem).map(brief)),
      noAccount: list(charges.filter((r) => r.accountId === null || r.accountId === undefined).map(brief)),
      neverChecked: list(charges.filter((r) => !s(r.checkedOn)).map(brief)),
      notConfirmed: list(charges.filter((r) => ["to_confirm", "to_fill_in"].includes(s(r.status))).map(brief)),
      page: `${opts.origin}/billing`,
    };
  });
  const accounts = section(parts.accounts, "account ownership", (v) => {
    const rows = arr(obj(v).accounts);
    const brief = (r: Obj) => ({ id: num(r.id), name: s(r.name), vendor: s(r.vendor) || null, status: s(r.status) });
    return {
      accounts: rows.length,
      noMainOwner: list(rows.filter((r) => !s(r.mainOwner).trim()).map(brief)),
      noItAccess: list(rows.filter((r) => !s(r.itAccess).trim()).map(brief)),
      noBillsTo: list(rows.filter((r) => !s(r.billsTo).trim()).map(brief)),
      page: `${opts.origin}/billing?tab=accounts`,
    };
  });
  return {
    ...(opts.systems.length ? { systems: opts.systems } : {}),
    tickets,
    billing,
    accounts,
    assets: {
      notTracked:
        "The hub keeps no asset / device register and no expiry or renewal dates (domains, licences, SSL, subscriptions), so 'no expiry date' cannot be checked. System billing has a billing cycle (monthly / yearly) but no renewal date.",
    },
    note: "A part you may not open in the hub says so; the rest still answers. Lists show up to 15 each.",
  };
}

// ── the tools ───────────────────────────────────────────────────────────────

/** Run a round-4 tool, reading only through deps.read. null = not a round-4 tool. */
export async function runRound4Tool(name: string, args: Obj, deps: ToolDeps): Promise<ToolOutcome | null> {
  const systemsCsv = cleanSystemList(args.system);
  const systems = systemsCsv ? systemsCsv.split(",") : [];
  switch (name) {
    case "tickets_overdue": {
      const target = `tickets_overdue${systemsCsv ? `:${systemsCsv}` : ""}`;
      const r = await deps.read("/api/v1/dev/tickets/report", { range: "this" });
      if (!r.ok) return fail(r, "IT tickets", target);
      return { ok: true, body: summariseOverdue(r.value, { systems, origin: deps.origin }, deps.nowMs), target };
    }
    case "ticket_digest": {
      const w = periodWindow(args.period, args.from, args.to, deps.today, "week");
      if ("error" in w) return { ok: false, status: 400, message: w.error, note: "", target: "ticket_digest" };
      const limitRaw = Math.floor(Number(args.limit));
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(DIGEST_MAX_LIMIT, limitRaw) : DIGEST_DEFAULT_LIMIT;
      const target = `ticket_digest:${w.period}:${w.current.from}..${w.current.to}${systemsCsv ? `:${systemsCsv}` : ""}`;
      const q = (sp: Span, n: number) => ({ from: sp.start, to: sp.end, limit: n, ...(systemsCsv ? { system: systemsCsv } : {}) });
      // Two reads side by side: this period's tickets, and only the count of the previous period's.
      const [cur, prev] = await Promise.all([deps.read("/api/v1/dev/tickets/digest", q(w.current, limit)), deps.read("/api/v1/dev/tickets/digest", q(w.previous, 1))]);
      if (!cur.ok) return fail(cur, "IT tickets", target);
      return { ok: true, body: summariseDigest(cur.value, prev.ok ? prev.value : null, w, deps.origin), target };
    }
    case "data_gaps": {
      const target = `data_gaps${systemsCsv ? `:${systemsCsv}` : ""}`;
      const [report, billing, accounts] = await Promise.all([
        deps.read("/api/v1/dev/tickets/report", { range: "this" }),
        deps.read("/api/v1/dev/billing"),
        deps.read("/api/v1/dev/accounts"),
      ]);
      return { ok: true, body: buildDataGaps({ report, billing, accounts }, { systems, origin: deps.origin }), target };
    }
    default:
      return null;
  }
}

// ── tool definitions (tools/list) ───────────────────────────────────────────

const RO = { readOnlyHint: true, openWorldHint: false };
const PERIOD_PROPS = {
  period: { type: "string", enum: [...PERIODS], description: "today | week (Monday to today) | month (default for most tools) | last_month | quarter | year | custom (give from and to). Malaysia days." },
  from: { type: "string", description: "YYYY-MM-DD, for period custom" },
  to: { type: "string", description: "YYYY-MM-DD, for period custom" },
};

export const ROUND4_TOOLS = [
  {
    name: "tickets_overdue",
    title: "Overdue and urgent unassigned tickets (quick answer)",
    description:
      "Open tickets past their SLA (the Reports page's rule: high 24 h, medium 3 d, low 7 d from submitted, not counting time waiting on the reporter) by system, assignee and priority, most overdue first; and every high-priority ticket nobody is assigned to. ONE call.",
    inputSchema: { type: "object", properties: { system: { type: "string", description: "Comma list of system codes, e.g. HC,HK. Default: all." } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "ticket_digest",
    title: "Recent tickets in short (quick answer)",
    description:
      "What the recent IT tickets are about, grouped by system: for each ticket raised in the period, the subject, a ~200-character summary of what was reported, the latest comment (trimmed), status and assignee; with the count against the previous period. Default period: this week.",
    inputSchema: {
      type: "object",
      properties: {
        ...PERIOD_PROPS,
        system: { type: "string", description: "Comma list of system codes, e.g. HC,HK. Default: all." },
        limit: { type: "number", description: `Most tickets to list (newest first). Default ${DIGEST_DEFAULT_LIMIT}, at most ${DIGEST_MAX_LIMIT}.` },
      },
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: "data_gaps",
    title: "Data gaps to fix (quick answer)",
    description:
      "Records missing something: open tickets with no assignee or no module (category); system-billing charges with no amount, card, system, linked account or check date, or not confirmed; outside accounts with no main owner, IT access or bills-to. Parts the person may not open say so. ONE call.",
    inputSchema: { type: "object", properties: { system: { type: "string", description: "Ticket system codes, comma list. Default: all." } }, additionalProperties: false },
    annotations: RO,
  },
];
