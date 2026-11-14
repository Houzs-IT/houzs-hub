import { sql } from "drizzle-orm";
import type { DB } from "../db/client";

// Reports dashboard. Every query covers all systems: the page filters by system
// itself and the per-system tables always compare all of them. The rows stay
// small (grouped counts, or one row per finished ticket in the window).
//
// Durations skip tickets imported from the old Sheet (legacy_code set): most of
// them carry resolved_at = created_at, which would read as "fixed instantly".

export type ReportRange = "this" | "last" | 6 | 12;

const MY_OFFSET = 8 * 3600_000;
const MY = "Asia/Kuala_Lumpur";

const CREATED = sql`t.created_at::timestamptz`;
// Done = Done or Closed. Rejected counts as ended (it leaves the backlog) but not as done.
const DONE_AT = sql`(CASE WHEN t.status IN ('resolved', 'closed') THEN COALESCE(t.resolved_at, t.closed_at)::timestamptz END)`;
const ENDED_AT = sql`(CASE WHEN t.status IN ('resolved', 'closed', 'rejected') THEN COALESCE(t.resolved_at, t.closed_at, t.updated_at)::timestamptz END)`;
const ACTIVE = sql`t.status IN ('open', 'in_progress', 'on_hold', 'testing', 'waiting_reporter')`;
// Hours the ticket has spent in Waiting Reporter, from its status changes (still waiting = until now).
// The SLA clock stops while IT waits on the reporter.
const WAITING_H = sql`COALESCE((SELECT sum(EXTRACT(EPOCH FROM COALESCE(s.next_at, now()) - s.at)) / 3600 FROM (
    SELECT e.to_value, e.created_at::timestamptz AS at,
      LEAD(e.created_at::timestamptz) OVER (ORDER BY e.created_at, e.id) AS next_at
    FROM ticket_events e WHERE e.ticket_id = t.id AND e.kind = 'status') s
  WHERE s.to_value = 'waiting_reporter'), 0)`;
// Who held the ticket at a moment: the last assign event up to then, else whoever holds it now.
const HOLDER_AT = (at: ReturnType<typeof sql>) => sql`COALESCE((SELECT e.to_value FROM ticket_events e
    WHERE e.ticket_id = t.id AND e.kind = 'assign' AND e.created_at::timestamptz <= ${at}
    ORDER BY e.created_at DESC, e.id DESC LIMIT 1), u.name)`;
// Who picked it up: the first person it was assigned to.
const FIRST_HOLDER = sql`COALESCE((SELECT e.to_value FROM ticket_events e
    WHERE e.ticket_id = t.id AND e.kind = 'assign' AND e.to_value IS NOT NULL
    ORDER BY e.created_at, e.id LIMIT 1), u.name)`;

// "this" / "last" = one Malaysia month by day; 6 / 12 = that many months by month,
// the current one included. The window runs to now, or to the month's end for "last".
export function reportWindow(range: ReportRange, nowMs = Date.now()) {
  const my = new Date(nowMs + MY_OFFSET);
  const y = my.getUTCFullYear();
  const m = range === "last" ? my.getUTCMonth() - 1 : my.getUTCMonth();
  const daily = range === "this" || range === "last";
  const keys = daily
    ? Array.from({ length: new Date(Date.UTC(y, m + 1, 0)).getUTCDate() }, (_, i) => new Date(Date.UTC(y, m, i + 1)).toISOString().slice(0, 10))
    : Array.from({ length: range }, (_, i) => new Date(Date.UTC(y, m - (range - 1 - i), 1)).toISOString().slice(0, 7));
  // Malaysia midnight at the start of each key, and after the last one.
  const startOf = (key: string) => Date.parse(`${daily ? key : `${key}-01`}T00:00:00+08:00`);
  const starts = keys.map(startOf);
  const monthEnd = Date.UTC(y, m + 1, 1) - MY_OFFSET;
  const start = starts[0];
  const end = Math.min(nowMs, monthEnd);
  // The comparison window is the same length, straight before this one.
  const prevStart = start - (end - start);
  const keyEnds = starts.map((_, i) => (i + 1 < starts.length ? starts[i + 1] : monthEnd));
  return {
    daily,
    keys,
    today: my.toISOString().slice(0, daily ? 10 : 7),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    prevStart: new Date(prevStart).toISOString(),
    // Backlog is read at the end of each key; the key holding now is read at now, later keys not at all.
    backlogAt: keyEnds.map((e, i) => (e <= nowMs ? new Date(e).toISOString() : starts[i] <= nowMs ? new Date(nowMs).toISOString() : null)),
  };
}

type Row = Record<string, unknown>;
const rows = async <T>(db: DB, q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

export async function buildReport(db: DB, range: ReportRange) {
  const w = reportWindow(range);
  const fmt = w.daily ? "YYYY-MM-DD" : "YYYY-MM";
  const key = (ts: ReturnType<typeof sql>) => sql`to_char(${ts} AT TIME ZONE ${MY}, ${fmt})`;
  const inWindow = (ts: ReturnType<typeof sql>) => sql`(${ts} >= ${w.start}::timestamptz AND ${ts} < ${w.end}::timestamptz)`;
  // This window and the one before it.
  const inBoth = (ts: ReturnType<typeof sql>) => sql`(${ts} >= ${w.prevStart}::timestamptz AND ${ts} < ${w.end}::timestamptz)`;
  const period = (ts: ReturnType<typeof sql>) => sql`CASE WHEN ${ts} >= ${w.start}::timestamptz THEN 'now' ELSE 'prev' END`;
  const backlogPoints = w.keys.map((k, i) => ({ k, at: w.backlogAt[i] })).filter((p): p is { k: string; at: string } => !!p.at);

  const [active, openTickets, done, response, opened, flowOpened, flowDone, backlog, reopened, reporters, followUps, modules] = await Promise.all([
    // Open tickets now, by system / type / status / priority / age band.
    rows<Row>(
      db,
      sql`SELECT t.system_code AS sys, t.type, t.status, t.priority, (t.assignee_id IS NULL) AS unassigned,
        CASE WHEN now() - ${CREATED} < interval '7 days' THEN 'd0'
             WHEN now() - ${CREATED} < interval '14 days' THEN 'd7'
             WHEN now() - ${CREATED} < interval '30 days' THEN 'd14'
             ELSE 'd30' END AS age,
        count(*)::int AS n, min(t.created_at) AS oldest
      FROM tickets t WHERE ${ACTIVE} GROUP BY 1, 2, 3, 4, 5, 6`,
    ),
    // Every open ticket, for the oldest list and each person's queue. stage_since is the
    // last status change, or submission when it never moved.
    rows<Row>(
      db,
      sql`SELECT t.code, t.title, t.system_code AS sys, t.type, t.status, t.priority, t.created_at, t.module, (t.legacy_code IS NOT NULL) AS legacy,
        t.assignee_id, u.name AS assignee, round(${WAITING_H}::numeric, 2)::float8 AS waiting_hours,
        COALESCE((SELECT max(e.created_at) FROM ticket_events e WHERE e.ticket_id = t.id AND e.kind = 'status'), t.created_at) AS stage_since
      FROM tickets t LEFT JOIN users u ON u.id = t.assignee_id WHERE ${ACTIVE}`,
    ),
    // One row per ticket done in this or the previous window; hours is null for imported ones.
    // it_hours leaves out the time spent waiting on the reporter (what the SLA counts).
    // assignee is whoever held the ticket when it was done; k is the day / month it was done,
    // so the IT team panel can show each person's done tickets per day.
    rows<Row>(
      db,
      sql`SELECT t.code, t.title, ${key(DONE_AT)} AS k, t.system_code AS sys, t.type, t.priority, t.module, ${period(DONE_AT)} AS period, ${HOLDER_AT(DONE_AT)} AS assignee,
        CASE WHEN t.legacy_code IS NULL THEN round((EXTRACT(EPOCH FROM ${DONE_AT} - ${CREATED}) / 3600)::numeric, 2)::float8 END AS hours,
        CASE WHEN t.legacy_code IS NULL THEN round((EXTRACT(EPOCH FROM ${DONE_AT} - ${CREATED}) / 3600 - ${WAITING_H})::numeric, 2)::float8 END AS it_hours
      FROM tickets t LEFT JOIN users u ON u.id = t.assignee_id WHERE ${inBoth(DONE_AT)}`,
    ),
    // First response: hours from submitted to picked up, for tickets submitted in either window.
    rows<Row>(
      db,
      sql`SELECT t.system_code AS sys, t.type, t.priority, ${period(CREATED)} AS period, ${FIRST_HOLDER} AS assignee,
        round((EXTRACT(EPOCH FROM t.picked_up_at::timestamptz - ${CREATED}) / 3600)::numeric, 2)::float8 AS hours
      FROM tickets t LEFT JOIN users u ON u.id = t.assignee_id WHERE ${inBoth(CREATED)} AND t.legacy_code IS NULL`,
    ),
    rows<Row>(
      db,
      sql`SELECT t.system_code AS sys, t.type, ${period(CREATED)} AS period, count(*)::int AS n
      FROM tickets t WHERE ${inBoth(CREATED)} GROUP BY 1, 2, 3`,
    ),
    rows<Row>(
      db,
      sql`SELECT ${key(CREATED)} AS k, t.system_code AS sys, t.type, count(*)::int AS n
      FROM tickets t WHERE ${inWindow(CREATED)} GROUP BY 1, 2, 3`,
    ),
    rows<Row>(
      db,
      sql`SELECT ${key(DONE_AT)} AS k, t.system_code AS sys, t.type, count(*)::int AS n
      FROM tickets t WHERE ${inWindow(DONE_AT)} GROUP BY 1, 2, 3`,
    ),
    // Tickets still open at the end of each day / month (or now, for the current one).
    backlogPoints.length
      ? rows<Row>(
          db,
          sql`SELECT p.k, t.system_code AS sys, t.type, count(t.id)::int AS n
          FROM unnest(ARRAY[${sql.join(
            backlogPoints.map((p) => sql`${p.k}::text`),
            sql`, `,
          )}], ARRAY[${sql.join(
            backlogPoints.map((p) => sql`${p.at}::timestamptz`),
            sql`, `,
          )}]) AS p(k, at)
          JOIN tickets t ON ${CREATED} < p.at AND (${ENDED_AT} IS NULL OR ${ENDED_AT} >= p.at)
          GROUP BY 1, 2, 3`,
        )
      : Promise.resolve([] as Row[]),
    // A done ticket moved back to work: the fix did not hold.
    rows<Row>(
      db,
      sql`SELECT t.system_code AS sys, t.type, ${period(sql`e.created_at::timestamptz`)} AS period, ${HOLDER_AT(sql`e.created_at::timestamptz`)} AS assignee, count(*)::int AS n
      FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id LEFT JOIN users u ON u.id = t.assignee_id
      WHERE e.kind = 'status' AND e.from_value IN ('resolved', 'closed') AND e.to_value NOT IN ('resolved', 'closed', 'rejected')
        AND ${inBoth(sql`e.created_at::timestamptz`)}
      GROUP BY 1, 2, 3, 4`,
    ),
    rows<Row>(
      db,
      sql`SELECT t.reporter_name AS name, t.system_code AS sys, max(t.reporter_department) AS department,
        count(*) FILTER (WHERE ${inWindow(CREATED)})::int AS opened,
        count(*) FILTER (WHERE ${inWindow(CREATED)} AND t.type = 'bug')::int AS bugs,
        count(*) FILTER (WHERE ${ACTIVE})::int AS open_now
      FROM tickets t WHERE ${inWindow(CREATED)} OR ${ACTIVE}
      GROUP BY 1, 2`,
    ),
    // Reporter replies on their own tickets in this window: how often they had to chase.
    rows<Row>(
      db,
      sql`SELECT t.reporter_name AS name, t.system_code AS sys, count(*)::int AS n
      FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id
      WHERE e.kind = 'comment' AND e.author_kind = 'reporter' AND ${inWindow(sql`e.created_at::timestamptz`)}
      GROUP BY 1, 2`,
    ),
    // Per system and module: submitted this period and open now. module is null when not set.
    rows<Row>(
      db,
      sql`SELECT t.system_code AS sys, t.module,
        count(*) FILTER (WHERE ${inWindow(CREATED)})::int AS opened,
        count(*) FILTER (WHERE ${inWindow(CREATED)} AND t.type = 'bug')::int AS bugs,
        count(*) FILTER (WHERE ${ACTIVE})::int AS open_now
      FROM tickets t WHERE ${inWindow(CREATED)} OR ${ACTIVE}
      GROUP BY 1, 2`,
    ),
  ]);

  return {
    range,
    daily: w.daily,
    keys: w.keys,
    today: w.today,
    start: w.start,
    prev_start: w.prevStart,
    end: w.end,
    active,
    open_tickets: openTickets,
    done,
    response,
    opened,
    flow_opened: flowOpened,
    flow_done: flowDone,
    backlog,
    reopened,
    reporters,
    follow_ups: followUps,
    modules,
  };
}
