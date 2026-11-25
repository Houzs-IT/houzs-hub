// ---------------------------------------------------------------------------
// mcp-quick.ts — the AI Connector's quick answers (routes/mcp.ts ticket_summary,
// health_summary, search, fetch, prompts). Owner 2026-11-25: searching through
// the connector felt slow — the AI walked list_modules → list_endpoints →
// erp_get and then read whole replies (the ticket report and the health page
// are tens of thousands of characters). A quick answer is ONE tool call that
// reads the same endpoints the portal reads, as the person (so need(...)
// applies), and returns a few thousand characters.
//
// Pure functions over the endpoints' JSON, no imports, so `node --test` can load
// this file directly (backend/test/mcp-quick.test.mjs).
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const s = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

// ISO timestamps sort as plain strings; localeCompare is far slower over 2,000+ health checks.
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Today in Malaysia (UTC+8) as YYYY-MM-DD. */
export function myToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** "YYYY-MM" n months before (or after, negative n) the given month. */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}

const monthsBetween = (a: string, b: string): number => {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};

export type TicketWindow = {
  from: string;
  to: string;
  /** The /tickets/report range that covers from..to. */
  range: "this" | "last" | 6 | 12;
  /** "day": counts are exact for from..to; "month": whole months (the report keys months). */
  granularity: "day" | "month";
};

/**
 * Pick the smallest /tickets/report window that covers from..to (default: this
 * month to today). The report counts by day for this / last month and by month
 * for the 6- and 12-month windows, so a range spanning months is rounded to whole
 * months. Null when the range is invalid or reaches more than 12 months back.
 */
export function ticketWindow(fromRaw: unknown, toRaw: unknown, today: string): TicketWindow | { error: string } {
  const thisMonth = today.slice(0, 7);
  const from = s(fromRaw).trim() || `${thisMonth}-01`;
  let to = s(toRaw).trim() || today;
  if (!YMD.test(from) || !YMD.test(to)) return { error: "Give from and to as YYYY-MM-DD." };
  if (to > today) to = today;
  if (from > to) return { error: "from must be on or before to (and not in the future)." };
  const fm = from.slice(0, 7);
  const tm = to.slice(0, 7);
  if (fm === thisMonth && tm === thisMonth) return { from, to, range: "this", granularity: "day" };
  const last = shiftMonth(thisMonth, 1);
  if (fm === last && tm === last) return { from, to, range: "last", granularity: "day" };
  const back = monthsBetween(fm, thisMonth);
  if (back <= 5) return { from, to, range: 6, granularity: "month" };
  if (back <= 11) return { from, to, range: 12, granularity: "month" };
  return { error: "The ticket report reaches back 12 months at most (this month included)." };
}

const STATUS_LABEL: Record<string, string> = {
  open: "open",
  in_progress: "inProgress",
  on_hold: "onHold",
  testing: "testing",
  waiting_reporter: "waitingReporter",
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return Math.round((a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) * 10) / 10;
};

const ageDays = (createdAt: unknown, nowMs: number): number => {
  const t = Date.parse(s(createdAt));
  return Number.isFinite(t) ? Math.floor((nowMs - t) / DAY_MS) : 0;
};

/**
 * Ticket answer from GET /api/v1/dev/tickets/report?range=… (the Reports page's
 * own numbers) and GET /api/v1/dev/tickets/stats (the sidebar badges). Open
 * tickets are "now"; new / resolved are for the window.
 */
export function summariseTickets(report: unknown, stats: unknown, w: TicketWindow, system: string | null, nowMs: number = Date.now()) {
  const r = obj(report);
  const sysOk = (row: Obj) => !system || s(row.sys) === system;
  const open = arr(r.open_tickets).filter(sysOk);

  const byStatus: Record<string, number> = { open: 0, inProgress: 0, onHold: 0, testing: 0, waitingReporter: 0 };
  const bySystem = new Map<string, { total: number; high: number; unassigned: number } & Record<string, number>>();
  const byAssignee = new Map<string, Record<string, number>>();
  for (const t of open) {
    const st = STATUS_LABEL[s(t.status)] ?? s(t.status);
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    const sys = s(t.sys);
    const e = bySystem.get(sys) ?? ({ total: 0, high: 0, unassigned: 0 } as { total: number; high: number; unassigned: number } & Record<string, number>);
    e.total++;
    e[st] = (e[st] ?? 0) + 1;
    if (s(t.priority) === "high") e.high++;
    if (!t.assignee) e.unassigned++;
    bySystem.set(sys, e);
    const who = s(t.assignee) || "Unassigned";
    const a = byAssignee.get(who) ?? { total: 0 };
    a.total++;
    a[st] = (a[st] ?? 0) + 1;
    byAssignee.set(who, a);
  }

  const brief = (t: Obj) => ({
    code: s(t.code),
    title: s(t.title).slice(0, 120),
    system: s(t.sys),
    status: s(t.status),
    priority: s(t.priority),
    assignee: s(t.assignee) || null,
    ageDays: ageDays(t.created_at, nowMs),
  });
  const byAge = [...open].sort((a, b) => cmp(s(a.created_at), s(b.created_at)));
  const high = byAge.filter((t) => s(t.priority) === "high");

  // New / resolved in the window, from the report's per-key flow rows.
  const keyFrom = w.granularity === "day" ? w.from : w.from.slice(0, 7);
  const keyTo = w.granularity === "day" ? w.to : w.to.slice(0, 7);
  const inKeys = (row: Obj) => sysOk(row) && s(row.k) >= keyFrom && s(row.k) <= keyTo;
  const flow = (rows: unknown) => {
    const bySys: Record<string, number> = {};
    let total = 0;
    for (const x of arr(rows).filter(inKeys)) {
      total += num(x.n);
      bySys[s(x.sys)] = (bySys[s(x.sys)] ?? 0) + num(x.n);
    }
    return { total, bySystem: bySys };
  };
  const created = flow(r.flow_opened);
  const resolved = flow(r.flow_done);
  const doneRows = arr(r.done).filter((x) => s(x.period) === "now" && inKeys(x));
  const st = obj(stats);

  return {
    window: {
      from: w.granularity === "day" ? w.from : `${keyFrom}-01`,
      to: w.to,
      ...(w.granularity === "month" ? { note: "Counted by whole months: the ticket report keys ranges longer than a month by month." } : {}),
    },
    ...(system ? { system } : {}),
    openNow: {
      total: open.length,
      byStatus,
      highPriority: high.length,
      unassigned: open.filter((t) => !t.assignee).length,
      bySystem: Object.fromEntries([...bySystem.entries()].sort((a, b) => b[1].total - a[1].total)),
      byAssignee: Object.fromEntries([...byAssignee.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 20)),
      ...(system ? {} : { assignedToYou: num(st.my_active) }),
    },
    inWindow: {
      new: created.total,
      resolved: resolved.total,
      newBySystem: created.bySystem,
      resolvedBySystem: resolved.bySystem,
      medianHoursToResolve: median(doneRows.map((x) => x.hours).filter((h): h is number => typeof h === "number")),
      medianItHoursToResolve: median(doneRows.map((x) => x.it_hours).filter((h): h is number => typeof h === "number")),
    },
    oldestOpen: byAge.slice(0, 5).map(brief),
    highPriorityOpen: high.slice(0, 15).map(brief),
    note: "Open = open, in progress, on hold, testing or waiting on the reporter. Resolved = moved to Done or Closed. IT hours leave out time spent waiting on the reporter. Ticket ids open with fetch.",
  };
}

// ── health ───────────────────────────────────────────────────────────────────

/** Slower than this counts as Slow — the same line as the System health page (HealthPage.tsx SLOW_MS). */
export const SLOW_MS = 2000;

/** Health answer from GET /api/v1/dev/health (targets + their last 24 h of checks + systems' own reports). */
export function summariseHealth(body: unknown, nowMs: number = Date.now()) {
  const b = obj(body);
  const targets = arr(b.targets).filter((t) => num(t.active) === 1 || t.active === true);
  const checks = arr(b.checks); // newest first
  const systemName = new Map(arr(b.systems).map((x) => [s(x.code), s(x.name)]));
  const byTarget = new Map<number, Obj[]>();
  for (const c of checks) {
    const id = num(c.targetId);
    const list = byTarget.get(id) ?? [];
    list.push(c);
    byTarget.set(id, list);
  }
  const minsAgo = (iso: unknown) => {
    const t = Date.parse(s(iso));
    return Number.isFinite(t) ? Math.round((nowMs - t) / 60_000) : null;
  };

  const down: Obj[] = [];
  const slow: Obj[] = [];
  const noData: string[] = [];
  let up = 0;
  for (const t of targets) {
    const list = (byTarget.get(num(t.id)) ?? []).sort((x, y) => cmp(s(y.checkedAt), s(x.checkedAt)));
    const last = list[0];
    const name = s(t.name);
    const system = t.systemCode ? systemName.get(s(t.systemCode)) ?? s(t.systemCode) : null;
    if (!last) {
      noData.push(name);
      continue;
    }
    const okCount = list.filter((c) => num(c.ok) === 1).length;
    const uptime24hPct = Math.round((okCount / list.length) * 1000) / 10;
    if (num(last.ok) !== 1) {
      // Down since the first failure of the current run of failures.
      let since = s(last.checkedAt);
      for (const c of list) {
        if (num(c.ok) === 1) break;
        since = s(c.checkedAt);
      }
      down.push({ name, system, error: s(last.error) || (last.status ? `HTTP ${s(last.status)}` : "no answer"), downSince: since, lastCheckedMinsAgo: minsAgo(last.checkedAt), uptime24hPct });
    } else if (num(last.ms) > SLOW_MS) {
      slow.push({ name, system, ms: num(last.ms), lastCheckedMinsAgo: minsAgo(last.checkedAt), uptime24hPct });
    } else {
      up++;
    }
  }

  // Systems' own health reports: the newest from each; flag the ones not OK.
  const reports = arr(obj(b.reports).latest).map((r) => {
    const rep = obj(r.report);
    const bad = arr(rep.checks).filter((c) => s(c.status) === "warning" || s(c.status) === "critical");
    return {
      system: systemName.get(s(r.systemCode)) ?? s(r.systemCode),
      ok: num(r.ok) === 1 || r.ok === true,
      receivedMinsAgo: minsAgo(r.receivedAt),
      ...(bad.length ? { problems: bad.slice(0, 8).map((c) => ({ check: s(c.label) || s(c.key), status: s(c.status), summary: s(c.summary).slice(0, 160) })) } : {}),
      ...(obj(rep.db).ok === false ? { database: "not OK" } : {}),
    };
  });

  const reportsNotOk = reports.filter((r) => !r.ok || r.problems);
  return {
    headline:
      down.length || slow.length
        ? `${down.length} down, ${slow.length} slow, ${up} up (of ${targets.length} checked systems)`
        : `All ${up} checked systems are up${noData.length ? ` (${noData.length} not checked yet)` : ""}`,
    down,
    slow,
    upCount: up,
    ...(noData.length ? { notCheckedYet: noData } : {}),
    systemReportsWithProblems: reportsNotOk,
    systemReportsOk: reports.filter((r) => r.ok && !r.problems).map((r) => r.system),
    note: `Checks run every 5 minutes. Slow = answered in more than ${SLOW_MS} ms. Uptime is over the last 24 hours.`,
  };
}

// ── erp_get "fields" ─────────────────────────────────────────────────────────

/** Keep only the named keys at every object level (rows stay rows). Empty list = unchanged. */
export function pickFields(v: unknown, fields: string[]): unknown {
  if (!fields.length) return v;
  const keep = new Set(fields);
  const walk = (x: unknown, depth: number): unknown => {
    if (depth > 20) return x;
    if (Array.isArray(x)) return x.map((y) => walk(y, depth + 1));
    if (x && typeof x === "object") {
      const out: Obj = {};
      for (const [k, val] of Object.entries(x as Obj)) {
        if (keep.has(k)) out[k] = val;
        else if (val && typeof val === "object") {
          const inner = walk(val, depth + 1);
          if (inner && typeof inner === "object" && Object.keys(inner as Obj).length) out[k] = inner;
        }
      }
      return out;
    }
    return x;
  };
  return walk(v, 0);
}

// ── search / fetch (the shape ChatGPT requires) ─────────────────────────────
// ChatGPT's company-knowledge / deep-research connectors call exactly these two:
// search {query} → {results:[{id,title,url}]}, fetch {id} → {id,title,text,url,metadata}.

/** A ticket code as the hub writes it (e.g. HC-123, HK-0042). */
export const TICKET_CODE = /^[A-Za-z0-9]{1,12}-[A-Za-z0-9-]{1,20}$/;

export type SearchHit = { id: string; title: string; url: string };

/** GET /api/v1/dev/tickets?q=… → ChatGPT search results; id = ticket code. */
export function ticketSearchResults(body: unknown, origin: string): SearchHit[] {
  return arr(obj(body).tickets)
    .filter((t) => s(t.code))
    .map((t) => ({
      id: s(t.code),
      title: `${s(t.code)} · ${s(t.title).slice(0, 100)} [${s(t.status)}${t.priority ? `, ${s(t.priority)}` : ""}${t.system_code ? `, ${s(t.system_code)}` : ""}]`,
      url: `${origin}/tickets/${encodeURIComponent(s(t.code))}`,
    }));
}

/** GET /api/v1/dev/tickets/:code → ChatGPT fetch document (plain text a model reads well). */
export function ticketDocument(body: unknown, origin: string, maxChars: number) {
  const b = obj(body);
  const t = obj(b.ticket);
  const code = s(t.code);
  const lines: string[] = [
    `${code}: ${s(t.title)}`,
    `System: ${s(t.system_name) || s(t.systemCode)}${t.module ? ` / ${s(t.module)}` : ""} · Type: ${s(t.type)} · Priority: ${s(t.priority)} · Status: ${s(t.status)}`,
    `Reported by ${s(t.reporterName)}${t.reporterDepartment ? ` (${s(t.reporterDepartment)})` : ""} on ${s(t.createdAt)}${t.resolvedAt ? ` · resolved ${s(t.resolvedAt)}` : ""}${t.closedAt ? ` · closed ${s(t.closedAt)}` : ""}`,
    ...(t.pageUrl ? [`Page: ${s(t.pageUrl)}`] : []),
    "",
    s(t.description),
    "",
    "Timeline:",
  ];
  for (const e of arr(b.events)) {
    const kind = s(e.kind);
    const who = s(e.authorName);
    const at = s(e.createdAt);
    const internal = s(e.visibility) === "internal" ? " (internal)" : "";
    const files = arr(e.attachments).map((a) => s(a.filename)).filter(Boolean);
    if (kind === "comment") lines.push(`- ${at} ${who}${internal}: ${s(e.body)}${files.length ? ` [files: ${files.join(", ")}]` : ""}`);
    else if (e.fromValue !== undefined || e.toValue !== undefined) lines.push(`- ${at} ${who}${internal}: ${kind} ${s(e.fromValue) || "—"} → ${s(e.toValue) || "—"}`);
    else lines.push(`- ${at} ${who}${internal}: ${kind}${e.body ? ` ${s(e.body)}` : ""}`);
  }
  let text = lines.join("\n");
  let cut = false;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    cut = true;
  }
  return {
    id: code,
    title: `${code} · ${s(t.title)}`,
    text,
    url: `${origin}/tickets/${encodeURIComponent(code)}`,
    metadata: {
      system: s(t.systemCode),
      status: s(t.status),
      priority: s(t.priority),
      type: s(t.type),
      createdAt: s(t.createdAt),
      updatedAt: s(t.updatedAt),
      events: arr(b.events).length,
      ...(cut ? { truncated: true } : {}),
    },
  };
}

// ── prompts (ready-made questions shown in the AI app) ──────────────────────

export const PROMPTS = [
  {
    name: "ticket_desk_today",
    title: "IT desk overview",
    description: "Open tickets by system and person, what is new and resolved this month, the oldest and the high-priority ones.",
    arguments: [{ name: "system", description: "System code, e.g. HC (default: all systems)", required: false }],
  },
  {
    name: "systems_health_now",
    title: "Are our systems up?",
    description: "Which systems are down or slow right now, since when, and any problems the systems report about themselves.",
    arguments: [],
  },
  {
    name: "find_ticket",
    title: "Find a ticket",
    description: "Find a ticket by code or words in it and summarise where it stands.",
    arguments: [{ name: "query", description: "Ticket code (e.g. HC-123) or words from its title / reporter", required: true }],
  },
];

/** The user message for a prompt, or null for an unknown prompt name. */
export function promptText(name: string, args: Obj): string | null {
  const a = (k: string) => s(args[k]).trim();
  switch (name) {
    case "ticket_desk_today": {
      const sys = a("system");
      return `Give me an overview of the IT desk${sys ? ` for ${sys}` : ""}: use ticket_summary${sys ? ` with system "${sys}"` : ""}. Tell me how many tickets are open, in progress and waiting on the reporter, by system and by person; how many came in and were resolved this month; and list the oldest open tickets and every high-priority open ticket with its code.`;
    }
    case "systems_health_now":
      return "Are all our systems up right now? Use health_summary. List anything down (and since when) or slow, and any problems the systems report about themselves. If everything is fine, say so in one line.";
    case "find_ticket": {
      const q = a("query");
      if (!q) return "Find a ticket: ask me for a ticket code or a few words from it, then use search and fetch.";
      return `Find the ticket "${q}": use search {query: "${q.replace(/"/g, "'")}"}, then fetch the best match. Summarise what was reported, its status, who has it, and the latest updates.`;
    }
    default:
      return null;
  }
}
