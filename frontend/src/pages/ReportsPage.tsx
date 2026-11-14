import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, type Priority, type Report, type ReportAge, type ReportRange, type Status, type TicketType } from "../api/client";
import { Avatar, Lozenge, PriorityIcon, SystemTag, TypeIcon } from "../components/Bits";
import { useHub } from "../components/Layout";
import { PRIORITIES, PRIORITY_LABEL, SLA_HOURS, STATUS_LABEL, TYPES, TYPE_LABEL } from "../lib/labels";
import { useFilters } from "../lib/useFilters";

const RANGES: { value: ReportRange; label: string }[] = [
  { value: "this", label: "This month" },
  { value: "last", label: "Last month" },
  { value: 6, label: "6 months" },
  { value: 12, label: "12 months" },
];
const AGES: { key: ReportAge; label: string }[] = [
  { key: "d0", label: "< 7 days" },
  { key: "d7", label: "7–14 days" },
  { key: "d14", label: "14–30 days" },
  { key: "d30", label: "30+ days" },
];
// Waiting on someone outside IT: the reporter, or parked on purpose.
const WAITING: Status[] = ["waiting_reporter", "on_hold"];
const DAY = 86_400_000;

const BAR = { submitted: "var(--chart-dev)", done: "var(--chart-done)", backlog: "var(--chart-backlog)" };

const shortMonth = (key: string) => new Date(`${key.slice(0, 7)}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
const longMonth = (key: string) => new Date(`${key.slice(0, 7)}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const longDay = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const daysOld = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / DAY);

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
}

function duration(hours: number | null) {
  if (hours === null) return "–";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

// SLA: done within its priority's hours, not counting time in Waiting Reporter.
// Imported tickets have no real times and count as neither met nor missed.
type Timed = { priority: Priority; it_hours: number | null };
const metSla = (x: Timed) => x.it_hours !== null && x.it_hours <= SLA_HOURS[x.priority];
function slaRate(rows: Timed[]) {
  const timed = rows.filter((x) => x.it_hours !== null);
  return timed.length ? Math.round((timed.filter(metSla).length / timed.length) * 100) : null;
}
const pct = (n: number | null) => (n === null ? "–" : `${n}%`);
// SLA hours an open ticket has used so far; past its target means overdue.
const slaUsed = (t: OpenTicket) => (Date.now() - Date.parse(t.created_at)) / 3_600_000 - t.waiting_hours;
const pastSla = (t: OpenTicket) => !t.legacy && slaUsed(t) > SLA_HOURS[t.priority];
// Targets are whole days or hours, so no decimals.
const slaTarget = (p: Priority) => (SLA_HOURS[p] % 24 === 0 ? `${SLA_HOURS[p] / 24} d` : `${SLA_HOURS[p]} h`);
const SLA_NOTE = `SLA: ${PRIORITIES.map((p) => `${PRIORITY_LABEL[p]} ${slaTarget(p)}`).join(", ")} from submitted to done, not counting time in Waiting Reporter.`;

// Round the axis top up to 1 / 2 / 5 x 10^n so there are at most four gridlines.
function axisTicks(max: number) {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw && Number.isInteger(s)) ?? Math.ceil(raw);
  const ticks = [];
  for (let v = 0; v < max + step; v += step) ticks.push(v);
  return ticks;
}

export default function ReportsPage() {
  const { systems, version } = useHub();
  const filters = useFilters();
  const system = filters.get("system");
  const rangeParam = filters.get("range");
  // Opens on this month; the other ranges are in the URL.
  const range: ReportRange = RANGES.find((r) => String(r.value) === rangeParam)?.value ?? "this";
  const tableType: TicketType = filters.get("type") === "development" ? "development" : "bug";
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api<Report>(`/tickets/report?range=${range}`)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
        setLoadedAt(new Date());
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [range, version]);

  // The old range's numbers stay up until the new one lands.
  const r = data;
  const mine = <T extends { sys: string }>(rows: T[]) => rows.filter((x) => !system || x.sys === system);
  const periodLabel =
    range === "this" ? "this month so far" : range === "last" ? (r ? longMonth(r.keys[0]) : "last month") : `the last ${range} months`;
  const soFar = r ? Math.max(1, Math.ceil((Date.parse(r.end) - Date.parse(r.start)) / DAY)) : 1;
  const prevLabel = !r
    ? ""
    : range === "last"
      ? "the month before"
      : range === "this"
        ? soFar === 1
          ? "the day before"
          : `the ${soFar} days before`
        : `the ${range} months before`;

  return (
    <div className="h-full overflow-auto px-4 py-6 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="eyebrow">Houzs Hub · Reports</div>
        <h1 className="mt-1 text-[20px] font-extrabold tracking-tight text-ink sm:text-[24px]">IT tickets report</h1>
        <p className="mt-1 text-[13px] text-ink-subtle">
          Open tickets are counted as they stand right now. Everything else covers {periodLabel} (Malaysia time), compared with {prevLabel || "the period before"}.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select className="input" aria-label="System" value={system ?? ""} onChange={(e) => filters.set({ system: e.target.value || null })}>
            <option value="">All systems</option>
            {systems.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <Segmented
            options={RANGES.map((x) => ({ value: String(x.value), label: x.label }))}
            value={String(range)}
            onChange={(v) => filters.set({ range: v === "this" ? null : v })}
          />
          <span className="text-[12px] text-ink-subtlest" aria-live="polite">
            {loading ? "Loading…" : loadedAt ? `Updated ${loadedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
        </div>

        {error && <div className="mt-4 rounded-md bg-loz-red px-3 py-2 text-[13px] text-loz-red-ink">{error}</div>}

        {!r && loading && <Skeleton />}

        {r && (
          <div className={`transition-opacity ${loading ? "opacity-60" : ""}`}>
            <JumpBar />
            <div id="now" className="scroll-mt-14">
              <NowSection r={r} mine={mine} system={system} />
              <PeriodSection r={r} mine={mine} prevLabel={prevLabel} />
            </div>
            <div id="trend" className="scroll-mt-14">
              <FlowChart r={r} mine={mine} />
            </div>
            <div id="team" className="scroll-mt-14">
              <Team r={r} mine={mine} prevLabel={prevLabel} />
            </div>
            <div id="systems" className="scroll-mt-14">
              <OpenBySystem r={r} systems={systems} system={system} />
              <Oldest r={r} mine={mine} />
            </div>
            <div id="speed" className="scroll-mt-14">
              <Speed r={r} mine={mine} prevLabel={prevLabel} />
              <Scorecard r={r} systems={systems} system={system} />
            </div>
            <div id="reporters" className="scroll-mt-14">
              <People r={r} mine={mine} />
              <Modules r={r} mine={mine} />
              <SubmittedTable r={r} systems={systems} system={system} tableType={tableType} onType={(t) => filters.set({ type: t === "bug" ? null : t })} />
            </div>
            <p className="mt-4 text-[12px] text-ink-subtlest">
              Times to done and first response leave out the tickets imported from the old Sheet: most of them carry no real done time.
              Done means Done or Closed; Rejected tickets leave the open count but are not counted as done.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

type Mine = <T extends { sys: string }>(rows: T[]) => T[];
type SystemList = { code: string; name: string }[];

// ---- Right now -------------------------------------------------------------

function NowSection({ r, mine, system }: { r: Report; mine: Mine; system: string | null }) {
  const active = mine(r.active);
  const n = (f: (x: Report["active"][number]) => boolean) => sum(active.filter(f).map((x) => x.n));
  const list = (extra: Record<string, string>) => `/tickets?${new URLSearchParams({ ...(system ? { system } : {}), ...extra })}`;
  const older = (from: ReportAge[]) => n((x) => from.includes(x.age));
  const overdue = mine(r.open_tickets).filter(pastSla).length;
  return (
    <Section title="Right now">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <Tile label="Open tickets" value={n(() => true)} to={list({ status: "active" })} note={`${n((x) => x.type === "bug")} bug · ${n((x) => x.type === "development")} dev`} />
        <Tile label="Not picked up" value={n((x) => x.status === "open")} to={list({ status: "open" })} note={`${n((x) => x.unassigned)} with no one assigned`} />
        <Tile label="Waiting on reporter / on hold" value={n((x) => WAITING.includes(x.status))} to={list({ status: WAITING.join(",") })} note="Not in IT's hands" />
        <Tile label="Past SLA" value={overdue} tone="bad" note="Over target, not counting waiting on reporter" />
        <Tile label="Open over 7 days" value={older(["d7", "d14", "d30"])} tone="warn" to={list({ status: "active", sort: "created", dir: "asc" })} />
        <Tile label="Open over 14 days" value={older(["d14", "d30"])} tone="warn" to={list({ status: "active", sort: "created", dir: "asc" })} />
        <Tile label="Open over 30 days" value={older(["d30"])} tone="bad" to={list({ status: "active", sort: "created", dir: "asc" })} />
      </div>
    </Section>
  );
}

// ---- This period -----------------------------------------------------------

function PeriodSection({ r, mine, prevLabel }: { r: Report; mine: Mine; prevLabel: string }) {
  const opened = mine(r.opened);
  const done = mine(r.done);
  const count = (rows: { period: string; n: number }[], p: string) => sum(rows.filter((x) => x.period === p).map((x) => x.n));
  const doneN = (p: string) => done.filter((x) => x.period === p).length;
  const median = (rows: { period: string; type: TicketType; hours: number | null }[], p: string, type?: TicketType) =>
    percentile(
      rows.filter((x) => x.period === p && (!type || x.type === type) && x.hours !== null).map((x) => x.hours!),
      0.5,
    );
  const response = mine(r.response);
  const reopened = mine(r.reopened);
  return (
    <Section title="This period">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <Tile label="Submitted" value={count(opened, "now")} note={vsCount(count(opened, "now"), count(opened, "prev"), prevLabel)} />
        <Tile label="Done" value={doneN("now")} note={vsCount(doneN("now"), doneN("prev"), prevLabel)} goodWhenUp />
        <SlaTile now={slaRate(done.filter((x) => x.period === "now"))} before={slaRate(done.filter((x) => x.period === "prev"))} />
        <Tile label="Bug: typical time to done" value={duration(median(done, "now", "bug"))} note={vsTime(median(done, "now", "bug"), median(done, "prev", "bug"))} />
        <Tile
          label="Development: typical time to done"
          value={duration(median(done, "now", "development"))}
          note={vsTime(median(done, "now", "development"), median(done, "prev", "development"))}
        />
        <Tile label="Typical first response" value={duration(median(response, "now"))} note={vsTime(median(response, "now"), median(response, "prev"))} />
        <Tile
          label="Reopened after done"
          value={count(reopened, "now")}
          note={vsCount(count(reopened, "now"), count(reopened, "prev"), prevLabel)}
          tone={count(reopened, "now") ? "warn" : undefined}
        />
      </div>
      <p className="mt-2 text-[12px] text-ink-subtlest">
        Typical = median: half the tickets took less, half took more. First response = submitted until someone picked it up. {SLA_NOTE}
      </p>
    </Section>
  );
}

// ---- Submitted vs done chart -----------------------------------------------

function FlowChart({ r, mine }: { r: Report; mine: Mine }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const at = (rows: Report["flow_opened"], k: string) => sum(mine(rows).filter((x) => x.k === k).map((x) => x.n));
  // Days / months still ahead have no open count yet.
  const series = r.keys.map((k) => ({
    key: k,
    submitted: at(r.flow_opened, k),
    done: at(r.flow_done, k),
    backlog: k > r.today ? null : at(r.backlog, k),
  }));
  const ticks = axisTicks(Math.max(0, ...series.flatMap((s) => [s.submitted, s.done, s.backlog ?? 0])));
  const top = ticks.at(-1)!;
  const todayAt = r.keys.indexOf(r.today);
  const label = r.daily ? longDay : longMonth;
  const line = series
    .map((s, i) => (s.backlog === null ? null : `${((i + 0.5) / series.length) * 100},${100 - (s.backlog / top) * 100}`))
    .filter(Boolean)
    .join(" ");
  const legend = [
    { label: "Submitted", color: BAR.submitted },
    { label: "Done", color: BAR.done },
  ];

  return (
    <section className="card mt-4 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">Submitted vs done, per {r.daily ? "day" : "month"}</h2>
        <div className="flex flex-wrap items-center gap-4 text-[12px] text-ink-subtle">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: BAR.backlog }} />
            Still open
          </span>
        </div>
      </div>

      <div className="mt-4 flex">
        <div className="relative w-7 shrink-0 text-right text-[11px] tabular-nums text-ink-subtlest" style={{ height: 220 }}>
          {ticks.map((v) => (
            <span key={v} className="absolute right-1.5" style={{ bottom: `${(v / top) * 100}%`, transform: "translateY(50%)" }}>
              {v}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: 220 }}>
            {ticks.map((v) => (
              <div
                key={v}
                className={`absolute inset-x-0 border-t ${v === 0 ? "border-line-strong" : "border-line-subtle"}`}
                style={{ bottom: `${(v / top) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex">
              {series.map((s, i) => (
                <div
                  key={s.key}
                  tabIndex={0}
                  aria-label={`${label(s.key)}: ${s.submitted} submitted, ${s.done} done${s.backlog === null ? "" : `, ${s.backlog} still open`}`}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                  onClick={() => setHovered(i)}
                  className={`relative flex flex-1 items-end justify-center gap-[2px] rounded-sm outline-none ${hovered === i ? "bg-surface-2" : ""}`}
                >
                  {(["submitted", "done"] as const).map((k) => (
                    <div key={k} className="w-full max-w-[14px] rounded-t-[4px]" style={{ height: `${(s[k] / top) * 100}%`, background: BAR[k] }} />
                  ))}
                  {hovered === i && (
                    <div
                      className={`pointer-events-none absolute bottom-full z-10 mb-1 w-max rounded-md border border-line bg-overlay px-2.5 py-1.5 text-[12px] shadow-overlay ${
                        i < series.length / 2 ? "left-0" : "right-0"
                      }`}
                    >
                      <div className="font-semibold text-ink">{label(s.key)}</div>
                      {[
                        ["Submitted", s.submitted],
                        ["Done", s.done],
                        ...(s.backlog === null ? [] : [["Still open at the end", s.backlog]]),
                      ].map(([l, v]) => (
                        <div key={l} className="flex items-center text-ink-subtle">
                          {l}
                          <span className="ml-auto pl-3 font-semibold tabular-nums text-ink">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline points={line} fill="none" stroke={BAR.backlog} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="flex pt-1.5">
            {series.map((s, i) => (
              <div key={s.key} className="flex-1 text-center text-[10.5px] leading-tight text-ink-subtlest">
                {r.daily ? (
                  // Every day fits on desktop; on a phone only 1, 5, 10, ... and today, minus any that would touch today's.
                  <span
                    className={`${i === todayAt || ((i === 0 || (i + 1) % 5 === 0) && Math.abs(i - todayAt) > 1) ? "" : "hidden sm:inline"} ${
                      i === todayAt ? "font-bold text-ink" : todayAt >= 0 && i > todayAt ? "opacity-50" : ""
                    }`}
                  >
                    {i + 1}
                  </span>
                ) : (
                  <>
                    {shortMonth(s.key)}
                    {(i === 0 || s.key.endsWith("-01")) && <div>{s.key.slice(0, 4)}</div>}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Open tickets per system -----------------------------------------------

const STATUS_COLUMNS: Status[] = ["open", "in_progress", "testing", "waiting_reporter", "on_hold"];

function OpenBySystem({ r, systems, system }: { r: Report; systems: SystemList; system: string | null }) {
  const doneBySys = (code: string) => r.done.filter((x) => x.period === "now" && x.sys === code).length;
  const rows = systems.map((s) => {
    const a = r.active.filter((x) => x.sys === s.code);
    const n = (f: (x: Report["active"][number]) => boolean) => sum(a.filter(f).map((x) => x.n));
    const oldest = a.map((x) => x.oldest).sort()[0];
    return {
      ...s,
      total: n(() => true),
      byStatus: STATUS_COLUMNS.map((st) => n((x) => x.status === st)),
      unassigned: n((x) => x.unassigned),
      byAge: AGES.map((g) => n((x) => x.age === g.key)),
      oldestDays: oldest ? daysOld(oldest) : null,
      done: doneBySys(s.code),
    };
  });
  rows.sort((a, b) => b.total - a.total);
  const totals = {
    total: sum(rows.map((x) => x.total)),
    byStatus: STATUS_COLUMNS.map((_, i) => sum(rows.map((x) => x.byStatus[i]))),
    unassigned: sum(rows.map((x) => x.unassigned)),
    byAge: AGES.map((_, i) => sum(rows.map((x) => x.byAge[i]))),
    done: sum(rows.map((x) => x.done)),
  };
  return (
    <Section title="Open tickets per system" note="Right now, all systems. Click a system to see its open tickets.">
      <Table>
        <thead>
          <tr className="text-[11px] text-ink-subtle">
            <Th left sticky>
              System
            </Th>
            <Th>Total open</Th>
            {STATUS_COLUMNS.map((s) => (
              <Th key={s}>{STATUS_LABEL[s]}</Th>
            ))}
            <Th>No one assigned</Th>
            {AGES.map((g) => (
              <Th key={g.key}>{g.label}</Th>
            ))}
            <Th>Oldest</Th>
            <Th>Done this period</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.code} className={`border-t border-line-subtle ${s.code === system ? "bg-primary-soft" : ""}`}>
              <Td left sticky highlight={s.code === system}>
                <Link to={`/tickets?system=${encodeURIComponent(s.code)}&status=active&sort=created&dir=asc`} className="text-ink hover:text-primary hover:underline">
                  {s.name}
                </Link>
              </Td>
              <Td strong>{s.total}</Td>
              {s.byStatus.map((n, i) => (
                <Td key={STATUS_COLUMNS[i]}>{n}</Td>
              ))}
              <Td tone={s.unassigned ? "warn" : undefined}>{s.unassigned}</Td>
              {s.byAge.map((n, i) => (
                <Td key={AGES[i].key} tone={n && i === 3 ? "bad" : n && i >= 1 ? "warn" : undefined}>
                  {n}
                </Td>
              ))}
              <Td>{s.oldestDays === null ? "–" : `${s.oldestDays} d`}</Td>
              <Td>{s.done}</Td>
            </tr>
          ))}
          <tr className="border-t border-line font-semibold">
            <Td left sticky>
              All systems
            </Td>
            <Td strong>{totals.total}</Td>
            {totals.byStatus.map((n, i) => (
              <Td key={STATUS_COLUMNS[i]}>{n}</Td>
            ))}
            <Td>{totals.unassigned}</Td>
            {totals.byAge.map((n, i) => (
              <Td key={AGES[i].key}>{n}</Td>
            ))}
            <Td>–</Td>
            <Td>{totals.done}</Td>
          </tr>
        </tbody>
      </Table>
      <AgeBars rows={rows} />
    </Section>
  );
}

const AGE_COLOR = ["var(--age-0)", "var(--age-7)", "var(--age-14)", "var(--age-30)"];

// The same open tickets as stacked bars, so the oldest pile-ups stand out.
function AgeBars({ rows }: { rows: { code: string; name: string; total: number; byAge: number[] }[] }) {
  const max = Math.max(1, ...rows.map((x) => x.total));
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-subtle">
        {AGES.map((g, i) => (
          <span key={g.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: AGE_COLOR[i] }} />
            Open {g.label}
          </span>
        ))}
      </div>
      <div className="mt-2 space-y-1.5">
        {rows
          .filter((x) => x.total)
          .map((s) => (
            <div key={s.code} className="flex items-center gap-2 text-[12px]">
              <div className="w-24 shrink-0 truncate text-ink-subtle sm:w-32">{s.name}</div>
              <div className="flex h-4 min-w-0 flex-1 overflow-hidden rounded-sm">
                <div className="flex h-full" style={{ width: `${(s.total / max) * 100}%` }}>
                  {s.byAge.map((n, i) =>
                    n ? <div key={i} title={`${AGES[i].label}: ${n}`} style={{ width: `${(n / s.total) * 100}%`, background: AGE_COLOR[i] }} /> : null,
                  )}
                </div>
              </div>
              <div className="w-8 shrink-0 text-right font-semibold tabular-nums text-ink">{s.total}</div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ---- Oldest open tickets ---------------------------------------------------

function Oldest({ r, mine }: { r: Report; mine: Mine }) {
  const rows = mine(r.open_tickets)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, 10);
  return (
    <Section title="Oldest open tickets" note="The ten waiting longest, whatever their status.">
      {rows.length === 0 ? (
        <Empty>No open tickets.</Empty>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {rows.map((t) => (
            <li key={t.code}>
              <Link to={`/tickets/${encodeURIComponent(t.code)}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-1 py-2 hover:bg-surface-2">
                <span className="w-12 shrink-0 text-[15px] font-extrabold tabular-nums text-loz-red-ink">{daysOld(t.created_at)} d</span>
                <TypeIcon type={t.type} size={14} />
                <span className="font-docno text-[12px] font-semibold text-ink-subtle">{t.code}</span>
                <span className="min-w-0 flex-1 basis-40 truncate text-[13px] text-ink">{t.title}</span>
                <PriorityIcon priority={t.priority} />
                {pastSla(t) && <SlaPill />}
                <Lozenge status={t.status} />
                <span className="flex items-center gap-1.5 text-[12px] text-ink-subtle">
                  <Avatar name={t.assignee} size={18} />
                  <span className="max-sm:hidden">{t.assignee ?? "No one"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---- Bug vs development speed ----------------------------------------------

function Speed({ r, mine, prevLabel }: { r: Report; mine: Mine; prevLabel: string }) {
  const done = mine(r.done);
  const response = mine(r.response);
  const groups: { label: ReactNode; type: TicketType; priority?: Priority }[] = TYPES.flatMap((type) => [
    {
      label: (
        <span className="flex items-center gap-1.5 font-semibold">
          <TypeIcon type={type} size={14} />
          {TYPE_LABEL[type]}
        </span>
      ),
      type,
    },
    ...PRIORITIES.map((priority) => ({
      label: (
        <span className="flex items-center gap-1 pl-5 text-ink-subtle">
          <PriorityIcon priority={priority} />
          {PRIORITY_LABEL[priority]}
          <span className="text-[11px] text-ink-subtlest">· SLA {slaTarget(priority)}</span>
        </span>
      ),
      type,
      priority,
    })),
  ]);
  return (
    <Section title="Speed: bug vs development" note={`Tickets done in this period. "Before" is the typical time to done in ${prevLabel}. ${SLA_NOTE}`}>
      <Table>
        <thead>
          <tr className="text-[11px] text-ink-subtle">
            <Th left sticky>
              Type
            </Th>
            <Th>Done</Th>
            <Th>Typical first response</Th>
            <Th>Typical time to done</Th>
            <Th>Excl. waiting on reporter</Th>
            <Th>9 in 10 done within</Th>
            <Th>Before</Th>
            <Th>Met SLA</Th>
            <Th>Still open</Th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => {
            const match = (x: { type: TicketType; priority: Priority }) => x.type === g.type && (!g.priority || x.priority === g.priority);
            const hours = (rows: { type: TicketType; priority: Priority; period: string; hours: number | null }[], p: string) =>
              rows.filter((x) => match(x) && x.period === p && x.hours !== null).map((x) => x.hours!);
            const doneNow = done.filter((x) => match(x) && x.period === "now");
            const itMedian = percentile(doneNow.filter((x) => x.it_hours !== null).map((x) => x.it_hours!), 0.5);
            const rate = slaRate(doneNow);
            const now = hours(done, "now");
            const med = percentile(now, 0.5);
            const prev = percentile(hours(done, "prev"), 0.5);
            const open = sum(mine(r.active).filter(match).map((x) => x.n));
            return (
              <tr key={i} className={`border-t ${g.priority ? "border-line-subtle" : "border-line"}`}>
                <Td left sticky>
                  {g.label}
                </Td>
                <Td strong={!g.priority}>{done.filter((x) => match(x) && x.period === "now").length}</Td>
                <Td>{duration(percentile(hours(response, "now"), 0.5))}</Td>
                <Td strong={!g.priority}>{duration(med)}</Td>
                <Td>{duration(itMedian)}</Td>
                <Td>{duration(percentile(now, 0.9))}</Td>
                <Td>
                  <span className={med !== null && prev !== null ? (med <= prev ? "text-loz-green-ink" : "text-loz-red-ink") : ""}>{duration(prev)}</span>
                </Td>
                <Td tone={rate !== null && rate < 80 ? "bad" : undefined}>{pct(rate)}</Td>
                <Td>{open}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Section>
  );
}

// ---- Systems compared ------------------------------------------------------

function Scorecard({ r, systems, system }: { r: Report; systems: SystemList; system: string | null }) {
  const totalNow = sum(r.opened.filter((x) => x.period === "now").map((x) => x.n));
  const rows = systems.map((s) => {
    const opened = r.opened.filter((x) => x.sys === s.code);
    const now = sum(opened.filter((x) => x.period === "now").map((x) => x.n));
    const prev = sum(opened.filter((x) => x.period === "prev").map((x) => x.n));
    const bugs = sum(opened.filter((x) => x.period === "now" && x.type === "bug").map((x) => x.n));
    const done = r.done.filter((x) => x.sys === s.code && x.period === "now");
    const bugHours = done.filter((x) => x.type === "bug" && x.hours !== null).map((x) => x.hours!);
    const reporters = r.reporters.filter((x) => x.sys === s.code && x.opened > 0).length;
    const chases = sum(r.follow_ups.filter((x) => x.sys === s.code).map((x) => x.n));
    const reopened = sum(r.reopened.filter((x) => x.sys === s.code && x.period === "now").map((x) => x.n));
    const open = sum(r.active.filter((x) => x.sys === s.code).map((x) => x.n));
    return { ...s, now, prev, bugs, done: done.length, bugMedian: percentile(bugHours, 0.5), sla: slaRate(done), reporters, chases, reopened, open };
  });
  rows.sort((a, b) => b.now - a.now || b.open - a.open);
  const maxShare = Math.max(1, ...rows.map((x) => x.now));
  return (
    <Section title="Systems compared" note="Who raises the most this period. All systems, whatever the filter above.">
      <Table>
        <thead>
          <tr className="text-[11px] text-ink-subtle">
            <Th left sticky>
              System
            </Th>
            <Th left>Share of submitted</Th>
            <Th>Submitted</Th>
            <Th>Before</Th>
            <Th>Bug share</Th>
            <Th>Done</Th>
            <Th>Typical bug fix</Th>
            <Th>Met SLA</Th>
            <Th>Reopened</Th>
            <Th>People reporting</Th>
            <Th>Reporter follow-ups</Th>
            <Th>Open now</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.code} className={`border-t border-line-subtle ${s.code === system ? "bg-primary-soft" : ""}`}>
              <Td left sticky highlight={s.code === system}>
                {s.name}
              </Td>
              <td className="min-w-[120px] px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${(s.now / maxShare) * 100}%`, background: BAR.submitted }} />
                  </div>
                  <span className="w-9 text-right text-[12px] tabular-nums text-ink-subtle">{totalNow ? Math.round((s.now / totalNow) * 100) : 0}%</span>
                </div>
              </td>
              <Td strong>{s.now}</Td>
              <Td>
                <span className={s.now > s.prev ? "text-loz-red-ink" : s.now < s.prev ? "text-loz-green-ink" : ""}>{s.prev}</span>
              </Td>
              <Td>{s.now ? `${Math.round((s.bugs / s.now) * 100)}%` : "–"}</Td>
              <Td>{s.done}</Td>
              <Td>{duration(s.bugMedian)}</Td>
              <Td tone={s.sla !== null && s.sla < 80 ? "bad" : undefined}>{pct(s.sla)}</Td>
              <Td tone={s.reopened ? "warn" : undefined}>{s.reopened}</Td>
              <Td>{s.reporters}</Td>
              <Td>{s.chases}</Td>
              <Td>{s.open}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

// ---- Reporters and departments ---------------------------------------------

function People({ r, mine }: { r: Report; mine: Mine }) {
  const chases = new Map(r.follow_ups.map((x) => [`${x.sys}|${x.name}`, x.n]));
  const reporters = mine(r.reporters)
    .filter((x) => x.opened > 0)
    .map((x) => ({ ...x, chases: chases.get(`${x.sys}|${x.name}`) ?? 0 }))
    .sort((a, b) => b.opened - a.opened || b.chases - a.chases)
    .slice(0, 10);
  const depts = new Map<string, { department: string; sys: string; opened: number; open: number; people: number }>();
  for (const x of mine(r.reporters)) {
    const department = x.department ?? "Not given";
    const key = `${x.sys}|${department}`;
    const d = depts.get(key) ?? { department, sys: x.sys, opened: 0, open: 0, people: 0 };
    d.opened += x.opened;
    d.open += x.open_now;
    if (x.opened) d.people += 1;
    depts.set(key, d);
  }
  const deptRows = [...depts.values()]
    .filter((d) => d.opened)
    .sort((a, b) => b.opened - a.opened)
    .slice(0, 10);
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Section title="Who raises the most" note="Top 10 reporters this period. Follow-ups = their replies chasing their tickets." flush>
        {reporters.length === 0 ? (
          <Empty>No tickets this period.</Empty>
        ) : (
          <Table>
            <thead>
              <tr className="text-[11px] text-ink-subtle">
                <Th left sticky>
                  Reporter
                </Th>
                <Th>Submitted</Th>
                <Th>Bug</Th>
                <Th>Dev</Th>
                <Th>Follow-ups</Th>
                <Th>Open now</Th>
              </tr>
            </thead>
            <tbody>
              {reporters.map((x) => (
                <tr key={`${x.sys}|${x.name}`} className="border-t border-line-subtle">
                  <Td left sticky>
                    <div className="flex items-center gap-1.5">
                      <SystemTag code={x.sys} />
                      <span className="truncate text-ink">{x.name}</span>
                    </div>
                    {x.department && <div className="text-[11px] text-ink-subtlest">{x.department}</div>}
                  </Td>
                  <Td strong>{x.opened}</Td>
                  <Td>{x.bugs}</Td>
                  {/* Two ticket types only, so whatever is not a bug is development. */}
                  <Td>{x.opened - x.bugs}</Td>
                  <Td tone={x.chases >= 3 ? "warn" : undefined}>{x.chases}</Td>
                  <Td>{x.open_now}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
      <Section title="Departments" note="Where the tickets come from this period. Imported Sheet tickets have no department." flush>
        {deptRows.length === 0 ? (
          <Empty>No tickets this period.</Empty>
        ) : (
          <Table>
            <thead>
              <tr className="text-[11px] text-ink-subtle">
                <Th left sticky>
                  Department
                </Th>
                <Th>Submitted</Th>
                <Th>People</Th>
                <Th>Open now</Th>
              </tr>
            </thead>
            <tbody>
              {deptRows.map((d) => (
                <tr key={`${d.sys}|${d.department}`} className="border-t border-line-subtle">
                  <Td left sticky>
                    <div className="flex items-center gap-1.5">
                      <SystemTag code={d.sys} />
                      <span className={d.department === "Not given" ? "text-ink-subtlest" : "text-ink"}>{d.department}</span>
                    </div>
                  </Td>
                  <Td strong>{d.opened}</Td>
                  <Td>{d.people}</Td>
                  <Td>{d.open}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  );
}

// ---- IT team ---------------------------------------------------------------

const STAGE_COLOR: Partial<Record<Status, string>> = {
  open: "rgb(var(--loz-grey-ink))",
  in_progress: "rgb(var(--loz-blue-ink))",
  testing: "rgb(var(--loz-purple-ink))",
  waiting_reporter: "rgb(var(--loz-orange-ink))",
  on_hold: "rgb(var(--loz-yellow-ink))",
};
const since = (iso: string) => duration((Date.now() - Date.parse(iso)) / 3_600_000);

type OpenTicket = Report["open_tickets"][number];

// Speed is credited to whoever holds the ticket now; hand-overs are rare enough not to skew it.
function Team({ r, mine, prevLabel }: { r: Report; mine: Mine; prevLabel: string }) {
  const open = mine(r.open_tickets);
  const done = mine(r.done);
  const response = mine(r.response);
  const reopened = mine(r.reopened);
  // "No one" only stands for unassigned open tickets: imported done tickets have no assignee either.
  const names = new Set<string | null>([
    ...open.map((t) => t.assignee),
    ...done.filter((x) => x.period === "now" && x.assignee).map((x) => x.assignee),
  ]);
  const people = [...names]
    .map((name) => {
      const o = open.filter((t) => t.assignee === name);
      const d = name === null ? [] : done.filter((x) => x.assignee === name);
      const hours = (p: string) => d.filter((x) => x.period === p && x.hours !== null).map((x) => x.hours!);
      return {
        name,
        id: o.find((t) => t.assignee_id)?.assignee_id ?? null,
        open: o,
        byStage: STATUS_COLUMNS.map((st) => o.filter((t) => t.status === st).length),
        overdue: o.filter(pastSla).length,
        sla: slaRate(d.filter((x) => x.period === "now")),
        done: d.filter((x) => x.period === "now").length,
        doneRows: d.filter((x) => x.period === "now"),
        donePrev: d.filter((x) => x.period === "prev").length,
        median: percentile(hours("now"), 0.5),
        p90: percentile(hours("now"), 0.9),
        prevMedian: percentile(hours("prev"), 0.5),
        response: name === null ? null : percentile(response.filter((x) => x.assignee === name && x.period === "now" && x.hours !== null).map((x) => x.hours!), 0.5),
        reopened: name === null ? 0 : sum(reopened.filter((x) => x.assignee === name && x.period === "now").map((x) => x.n)),
        oldest: o.map((t) => t.created_at).sort()[0] ?? null,
      };
    })
    .sort((a, b) => (a.name === null ? -1 : b.name === null ? 1 : b.open.length - a.open.length || b.done - a.done));
  const [picked, setPicked] = useState<string | null>(null);
  const key = (name: string | null) => name ?? "";
  // Opens on the busiest named person; "No one" is a click away.
  const selected = people.find((p) => key(p.name) === picked) ?? people.find((p) => p.name !== null && p.open.length) ?? people[0];
  const maxOpen = Math.max(1, ...people.map((p) => p.open.length));

  return (
    <Section
      title="IT team"
      note={`Open tickets per person right now, and what each finished in this period ("Before" = ${prevLabel}). Click a person to see what they finished each day and their open tickets by stage.`}
    >
      {people.length === 0 ? (
        <Empty>No open or finished tickets.</Empty>
      ) : (
        <>
          <StageLegend />
          <Table>
            <thead>
              <tr className="text-[11px] text-ink-subtle">
                <Th left sticky>
                  IT person
                </Th>
                <Th>Open now</Th>
                <Th left>By stage</Th>
                <Th>Past SLA</Th>
                <Th>Done</Th>
                <Th>Before</Th>
                <Th>Met SLA</Th>
                <Th>Typical time to done</Th>
                <Th>9 in 10 done within</Th>
                <Th>Typical first response</Th>
                <Th>Reopened</Th>
                <Th>Oldest open</Th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const on = selected && key(selected.name) === key(p.name);
                return (
                  <tr
                    key={key(p.name)}
                    onClick={() => setPicked(key(p.name))}
                    className={`cursor-pointer border-t border-line-subtle ${on ? "bg-primary-soft" : "hover:bg-surface-2"}`}
                  >
                    <Td left sticky highlight={on}>
                      <button type="button" aria-pressed={on} className="flex items-center gap-1.5 text-left" onClick={() => setPicked(key(p.name))}>
                        <Avatar name={p.name} size={20} />
                        <span className={p.name ? "font-medium text-ink" : "text-loz-orange-ink"}>{p.name ?? "No one assigned"}</span>
                      </button>
                    </Td>
                    <Td strong>{p.open.length}</Td>
                    <td className="min-w-[130px] px-2 py-1.5">
                      <StageBar counts={p.byStage} width={(p.open.length / maxOpen) * 100} />
                    </td>
                    <Td tone={p.overdue ? "bad" : undefined}>{p.overdue}</Td>
                    <Td strong={!!p.name}>{p.name ? p.done : "–"}</Td>
                    <Td>
                      {p.name ? <span className={p.done > p.donePrev ? "text-loz-green-ink" : p.done < p.donePrev ? "text-loz-red-ink" : ""}>{p.donePrev}</span> : "–"}
                    </Td>
                    <Td tone={p.sla !== null && p.sla < 80 ? "bad" : undefined}>{p.name ? pct(p.sla) : "–"}</Td>
                    <Td strong={p.median !== null}>
                      <span className={p.median !== null && p.prevMedian !== null ? (p.median <= p.prevMedian ? "text-loz-green-ink" : "text-loz-red-ink") : ""}>
                        {duration(p.median)}
                      </span>
                    </Td>
                    <Td>{duration(p.p90)}</Td>
                    <Td>{duration(p.response)}</Td>
                    <Td tone={p.reopened ? "warn" : undefined}>{p.reopened}</Td>
                    <Td tone={p.oldest && daysOld(p.oldest) >= 30 ? "bad" : p.oldest && daysOld(p.oldest) >= 7 ? "warn" : undefined}>
                      {p.oldest ? `${daysOld(p.oldest)} d` : "–"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="mt-2 text-[12px] text-ink-subtlest">
            Time to done is coloured against the person's own typical time before. A finished ticket counts for whoever held it when it was
            done; first response for whoever picked it up. {SLA_NOTE}
          </p>
          {selected && (
            <>
              {selected.name !== null && <DonePerDay key={key(selected.name)} r={r} name={selected.name} rows={selected.doneRows} />}
              <Queue name={selected.name} id={selected.id} tickets={selected.open} />
            </>
          )}
        </>
      )}
    </Section>
  );
}

function StageLegend() {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-subtle">
      {STATUS_COLUMNS.map((st) => (
        <span key={st} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: STAGE_COLOR[st] }} />
          {STATUS_LABEL[st]}
        </span>
      ))}
    </div>
  );
}

function StageBar({ counts, width }: { counts: number[]; width: number }) {
  const total = sum(counts);
  if (!total) return <span className="text-[12px] text-ink-disabled">–</span>;
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2">
      <div className="flex h-full" style={{ width: `${width}%` }}>
        {counts.map((n, i) =>
          n ? (
            <div
              key={STATUS_COLUMNS[i]}
              title={`${STATUS_LABEL[STATUS_COLUMNS[i]]}: ${n}`}
              style={{ width: `${(n / total) * 100}%`, background: STAGE_COLOR[STATUS_COLUMNS[i]] }}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}

// One person's open tickets as stage columns, the longest in its stage on top.
function Queue({ name, id, tickets }: { name: string | null; id: number | null; tickets: OpenTicket[] }) {
  const listLink = `/tickets?${new URLSearchParams({ assignee: name === null ? "none" : String(id ?? ""), status: "active" })}`;
  return (
    <div className="mt-4 border-t border-line-subtle pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Avatar name={name} size={24} />
        <h3 className="text-[14px] font-bold text-ink">{name ?? "No one assigned"}</h3>
        <span className="text-[12px] text-ink-subtle">{tickets.length} open</span>
        {(name === null || id !== null) && tickets.length > 0 && (
          <Link to={listLink} className="ml-auto text-[12px] font-semibold text-primary hover:underline">
            Open in list →
          </Link>
        )}
      </div>
      {tickets.length === 0 ? (
        <Empty>Nothing open right now.</Empty>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {STATUS_COLUMNS.map((st) => {
            const list = tickets.filter((t) => t.status === st).sort((a, b) => a.stage_since.localeCompare(b.stage_since));
            return (
              <div key={st} className={`min-w-0 rounded-lg bg-surface-2 p-2 ${list.length ? "" : "max-lg:hidden"}`}>
                <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                  <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[st] }} />
                  {STATUS_LABEL[st]}
                  <span className="ml-auto tabular-nums">{list.length}</span>
                </div>
                <div className="space-y-1.5">
                  {list.length === 0 && <div className="px-1 pb-1 text-[12px] text-ink-disabled">None</div>}
                  {list.map((t) => (
                    <Link
                      key={t.code}
                      to={`/tickets/${encodeURIComponent(t.code)}`}
                      className="block rounded-md border border-line-subtle bg-surface px-2.5 py-2 transition-colors hover:border-primary"
                    >
                      <div className="flex items-center gap-1.5">
                        <TypeIcon type={t.type} size={14} />
                        <span className="font-docno text-[11.5px] font-semibold text-ink-subtle">{t.code}</span>
                        <span className="ml-auto">
                          <PriorityIcon priority={t.priority} />
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-ink">{t.title}</div>
                      <div className="mt-1.5 text-[11px] text-ink-subtlest">
                        <span className={daysOld(t.stage_since) >= 7 ? "font-semibold text-loz-orange-ink" : ""}>{since(t.stage_since)} in stage</span>
                        {" · "}open {since(t.created_at)}
                      </div>
                      {!t.legacy && <SlaLeft t={t} />}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// One person's finished tickets per day (per month on the 6 / 12 month views); click a bar to list them.
function DonePerDay({ r, name, rows }: { r: Report; name: string; rows: Report["done"] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const series = r.keys.map((k) => ({ key: k, list: rows.filter((x) => x.k === k) }));
  const ticks = axisTicks(Math.max(0, ...series.map((s) => s.list.length)));
  const top = ticks.at(-1)!;
  const todayAt = r.keys.indexOf(r.today);
  const label = r.daily ? longDay : longMonth;
  const unit = r.daily ? "day" : "month";
  // Average over the days / months so far, the current one included.
  const elapsed = todayAt >= 0 ? todayAt + 1 : r.keys.length;
  const best = series.reduce<(typeof series)[number] | null>((b, s) => (s.list.length > (b?.list.length ?? 0) ? s : b), null);
  const pickedList = series.find((s) => s.key === picked)?.list ?? [];

  return (
    <div className="mt-4 border-t border-line-subtle pt-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 self-center text-[14px] font-bold text-ink">
          <Avatar name={name} size={24} />
          {name}: done per {unit}
        </h3>
        <span className="text-[12px] text-ink-subtle">
          <b className="tabular-nums text-ink">{rows.length}</b> done · <b className="tabular-nums text-ink">{(rows.length / elapsed).toFixed(1)}</b> a {unit} on
          average
          {best && (
            <>
              {" "}
              · most on {label(best.key)} (<b className="tabular-nums text-ink">{best.list.length}</b>)
            </>
          )}
        </span>
        {!r.daily && <span className="text-[12px] text-ink-subtlest">Pick This month or Last month to see it per day.</span>}
      </div>
      {rows.length === 0 ? (
        <Empty>Nothing finished in this period.</Empty>
      ) : (
        <>
          <div className="mt-3 flex">
            <div className="relative w-7 shrink-0 text-right text-[11px] tabular-nums text-ink-subtlest" style={{ height: 140 }}>
              {ticks.map((v) => (
                <span key={v} className="absolute right-1.5" style={{ bottom: `${(v / top) * 100}%`, transform: "translateY(50%)" }}>
                  {v}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative" style={{ height: 140 }}>
                {ticks.map((v) => (
                  <div
                    key={v}
                    className={`absolute inset-x-0 border-t ${v === 0 ? "border-line-strong" : "border-line-subtle"}`}
                    style={{ bottom: `${(v / top) * 100}%` }}
                  />
                ))}
                <div className="absolute inset-0 flex">
                  {series.map((s, i) => {
                    const n = s.list.length;
                    const h = `${(n / top) * 100}%`;
                    return (
                      <button
                        type="button"
                        key={s.key}
                        aria-label={`${label(s.key)}: ${n} done`}
                        aria-pressed={picked === s.key}
                        disabled={!n}
                        onMouseEnter={() => setHovered(i)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(i)}
                        onBlur={() => setHovered(null)}
                        onClick={() => setPicked(picked === s.key ? null : s.key)}
                        className={`relative flex flex-1 items-end justify-center rounded-sm outline-none ${n ? "cursor-pointer" : "cursor-default"} ${
                          picked === s.key ? "bg-primary-soft" : hovered === i && n ? "bg-surface-2" : ""
                        }`}
                      >
                        {n > 0 && <div className="w-full max-w-[18px] rounded-t-[4px]" style={{ height: h, background: BAR.done }} />}
                        {n > 0 && (
                          <span
                            className="pointer-events-none absolute text-[10px] font-semibold tabular-nums text-ink-subtle max-sm:hidden"
                            style={{ bottom: `calc(${h} + 2px)` }}
                          >
                            {n}
                          </span>
                        )}
                        {hovered === i && n > 0 && (
                          <div
                            className={`pointer-events-none absolute bottom-full z-10 mb-1 w-max rounded-md border border-line bg-overlay px-2.5 py-1.5 text-left text-[12px] shadow-overlay ${
                              i < series.length / 2 ? "left-0" : "right-0"
                            }`}
                          >
                            <div className="font-semibold text-ink">{label(s.key)}</div>
                            <div className="text-ink-subtle">{n} done · click to list them</div>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex pt-1.5">
                {series.map((s, i) => (
                  <div key={s.key} className="flex-1 text-center text-[10.5px] leading-tight text-ink-subtlest">
                    {r.daily ? (
                      <span
                        className={`${i === todayAt || ((i === 0 || (i + 1) % 5 === 0) && Math.abs(i - todayAt) > 1) ? "" : "hidden sm:inline"} ${
                          i === todayAt ? "font-bold text-ink" : todayAt >= 0 && i > todayAt ? "opacity-50" : ""
                        }`}
                      >
                        {i + 1}
                      </span>
                    ) : (
                      shortMonth(s.key)
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {picked && (
            <div className="mt-3 rounded-lg bg-surface-2 p-2">
              <div className="mb-2 flex items-center px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                Done on {label(picked)}
                <span className="ml-auto tabular-nums">{pickedList.length}</span>
              </div>
              <div className="space-y-1.5">
                {pickedList.map((t) => (
                  <Link
                    key={t.code}
                    to={`/tickets/${encodeURIComponent(t.code)}`}
                    className="flex items-center gap-2 rounded-md border border-line-subtle bg-surface px-2.5 py-2 transition-colors hover:border-primary"
                  >
                    <TypeIcon type={t.type} size={14} />
                    <span className="shrink-0 font-docno text-[11.5px] font-semibold text-ink-subtle">{t.code}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{t.title}</span>
                    <SystemTag code={t.sys} />
                    <PriorityIcon priority={t.priority} />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SlaPill() {
  return <span className="rounded-full bg-loz-red px-2 py-[3px] text-[10px] font-bold uppercase leading-none tracking-wider text-loz-red-ink">Past SLA</span>;
}

// Time left on an open ticket's SLA, or how far past it; the clock is paused while waiting on the reporter.
function SlaLeft({ t }: { t: OpenTicket }) {
  const left = SLA_HOURS[t.priority] - slaUsed(t);
  const paused = t.status === "waiting_reporter";
  const cls = left < 0 ? "font-semibold text-loz-red-ink" : left < SLA_HOURS[t.priority] / 4 ? "font-semibold text-loz-orange-ink" : "text-ink-subtlest";
  return (
    <div className={`mt-0.5 text-[11px] ${cls}`}>
      {left < 0 ? `Past SLA by ${duration(-left)}` : `SLA: ${duration(left)} left`}
      {paused && <span className="font-normal text-ink-subtlest"> · paused</span>}
    </div>
  );
}

function SlaTile({ now, before }: { now: number | null; before: number | null }) {
  const note = before === null ? undefined : { text: `Before: ${before}%`, good: now === null ? undefined : now >= before };
  return <Tile label="Met SLA" value={pct(now)} note={note} tone={now !== null && now < 80 ? "bad" : undefined} />;
}

// ---- Modules ---------------------------------------------------------------

function Modules({ r, mine }: { r: Report; mine: Mine }) {
  const rows = mine(r.modules);
  const done = mine(r.done).filter((x) => x.period === "now");
  const named = rows.filter((x) => x.module);
  const list = rows
    .map((x) => {
      const d = done.filter((y) => y.sys === x.sys && y.module === x.module);
      return { ...x, done: d.length, sla: slaRate(d) };
    })
    .filter((x) => x.opened || x.open_now)
    .sort((a, b) => b.opened - a.opened || b.open_now - a.open_now)
    .slice(0, 15);
  return (
    <Section
      title="By module"
      note="Which part of each system the tickets are about. Systems send the module with each ticket; IT can set or correct it on the ticket page."
    >
      {named.length === 0 ? (
        <Empty>No module set on any ticket yet. Set one on a ticket's page, or have the system send `module` with each ticket.</Empty>
      ) : (
        <Table>
          <thead>
            <tr className="text-[11px] text-ink-subtle">
              <Th left sticky>
                Module
              </Th>
              <Th>Submitted</Th>
              <Th>Bug</Th>
              <Th>Dev</Th>
              <Th>Open now</Th>
              <Th>Done</Th>
              <Th>Met SLA</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((x) => (
              <tr key={`${x.sys}|${x.module ?? ""}`} className="border-t border-line-subtle">
                <Td left sticky>
                  <div className="flex items-center gap-1.5">
                    <SystemTag code={x.sys} />
                    <span className={x.module ? "text-ink" : "text-ink-subtlest"}>{x.module ?? "Not set"}</span>
                  </div>
                </Td>
                <Td strong>{x.opened}</Td>
                <Td>{x.bugs}</Td>
                <Td>{x.opened - x.bugs}</Td>
                <Td>{x.open_now}</Td>
                <Td>{x.done}</Td>
                <Td tone={x.sla !== null && x.sla < 80 ? "bad" : undefined}>{pct(x.sla)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  );
}

// ---- Page bits -------------------------------------------------------------

const JUMPS = [
  ["now", "Now"],
  ["trend", "Trend"],
  ["team", "IT team"],
  ["systems", "Systems"],
  ["speed", "Speed"],
  ["reporters", "Reporters"],
] as const;

function JumpBar() {
  return (
    <nav aria-label="Report sections" className="sticky -top-6 z-10 -mx-4 mt-3 flex gap-1 overflow-x-auto bg-canvas/90 px-4 py-2 backdrop-blur md:-mx-8 md:px-8">
      {JUMPS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="tap shrink-0 rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-semibold text-ink-subtle hover:border-primary hover:text-primary"
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function Skeleton() {
  return (
    <div className="mt-4 animate-pulse space-y-4" aria-hidden>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="card h-[84px]" />
        ))}
      </div>
      <div className="card h-[280px]" />
      <div className="card h-[200px]" />
    </div>
  );
}

// ---- Submitted per system per day / month ----------------------------------

function SubmittedTable({
  r,
  systems,
  system,
  tableType,
  onType,
}: {
  r: Report;
  systems: SystemList;
  system: string | null;
  tableType: TicketType;
  onType: (t: TicketType) => void;
}) {
  const count = (k: string, sys?: string) => sum(r.flow_opened.filter((x) => x.k === k && x.type === tableType && (!sys || x.sys === sys)).map((x) => x.n));
  const shown = systems.filter((s) => !system || s.code === system);
  return (
    <Section
      title={`${TYPE_LABEL[tableType]} tickets submitted per system`}
      action={<Segmented options={TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} value={tableType} onChange={(v) => onType(v as TicketType)} />}
    >
      <Table>
        <thead>
          <tr className="text-[11px] text-ink-subtle">
            <Th left sticky>
              System
            </Th>
            {r.keys.map((k) => (
              <Th key={k} highlight={k === r.today}>
                {r.daily ? Number(k.slice(8)) : `${shortMonth(k)} ${k.slice(2, 4)}`}
              </Th>
            ))}
            <Th>Total</Th>
          </tr>
        </thead>
        <tbody>
          {[...shown.map((s) => ({ code: s.code, name: s.name })), ...(shown.length > 1 ? [{ code: "", name: "All systems" }] : [])].map((s) => {
            const cells = r.keys.map((k) => count(k, s.code || undefined));
            return (
              <tr key={s.code || "all"} className={`border-t border-line-subtle ${s.code ? "" : "font-semibold"}`}>
                <Td left sticky>
                  {s.name}
                </Td>
                {cells.map((n, i) => (
                  <td key={r.keys[i]} className={`px-2 py-1.5 text-right ${n ? "text-ink" : "text-ink-disabled"}`}>
                    {n}
                  </td>
                ))}
                <Td>{sum(cells)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Section>
  );
}

// ---- Bits ------------------------------------------------------------------

function Section({ title, note, action, flush, children }: { title: string; note?: string; action?: ReactNode; flush?: boolean; children: ReactNode }) {
  return (
    // min-w-0: inside a grid, a wide table would otherwise stretch the card past the screen.
    <section className={`card min-w-0 p-4 md:p-5 ${flush ? "" : "mt-4"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-title">{title}</h2>
          {note && <p className="mt-0.5 text-[12px] text-ink-subtlest">{note}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Segmented({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-[9px] border border-line bg-surface p-1 shadow-stone">
      {options.map((o) => (
        <button
          key={o.value}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`tap rounded px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
            o.value === value ? "bg-primary text-primary-on shadow-sm" : "text-ink-subtle hover:bg-primary-soft hover:text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TONE = { warn: "text-loz-orange-ink", bad: "text-loz-red-ink" };

function Tile({
  label,
  value,
  note,
  to,
  tone,
  goodWhenUp,
}: {
  label: string;
  value: number | string;
  note?: { text: string; good?: boolean } | string;
  to?: string;
  tone?: keyof typeof TONE;
  goodWhenUp?: boolean;
}) {
  const n = typeof note === "string" ? { text: note } : note;
  // Counts compare as "more is worse" unless the tile says otherwise.
  const good = n?.good === undefined ? undefined : goodWhenUp ? !n.good : n.good;
  const body = (
    <>
      <div className="text-[12px] leading-tight text-ink-subtle">{label}</div>
      <div className={`mt-1 text-[24px] font-extrabold tabular-nums ${value && tone ? TONE[tone] : "text-ink"}`}>{value}</div>
      {n && <div className={`text-[11.5px] leading-snug ${good === undefined ? "text-ink-subtle" : good ? "text-loz-green-ink" : "text-loz-red-ink"}`}>{n.text}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="card block px-4 py-3 transition-colors hover:border-primary">
      {body}
    </Link>
  ) : (
    <div className="card px-4 py-3">{body}</div>
  );
}

// "good" here means the number went down; Tile flips it for counts where up is good.
function vsCount(now: number, before: number, label: string) {
  if (now === before) return { text: `Same as ${label}` };
  return { text: `${now > before ? "+" : "−"}${Math.abs(now - before)} vs ${label} (${before})`, good: now < before };
}

function vsTime(now: number | null, before: number | null) {
  if (now === null || before === null) return before === null ? undefined : { text: `Before: ${duration(before)}` };
  return { text: `Before: ${duration(before)}`, good: now <= before };
}

function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 md:-mx-5 md:px-5">
      <table className="w-full whitespace-nowrap text-[13px] tabular-nums">{children}</table>
    </div>
  );
}

function Th({ children, left, sticky, highlight }: { children: ReactNode; left?: boolean; sticky?: boolean; highlight?: boolean }) {
  return (
    <th
      className={`px-2 py-1.5 font-semibold ${left ? "text-left" : "text-right"} ${sticky ? "sticky left-0 z-[1] bg-surface pl-0 pr-3" : ""} ${
        highlight ? "text-ink" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  left,
  sticky,
  strong,
  tone,
  highlight,
}: {
  children: ReactNode;
  left?: boolean;
  sticky?: boolean;
  strong?: boolean;
  tone?: keyof typeof TONE;
  highlight?: boolean;
}) {
  const zero = children === 0;
  return (
    <td
      className={`px-2 py-1.5 ${left ? "text-left" : "text-right"} ${sticky ? `sticky left-0 z-[1] pl-0 pr-3 ${highlight ? "bg-primary-soft" : "bg-surface"}` : ""} ${
        zero ? "text-ink-disabled" : tone ? TONE[tone] : "text-ink"
      } ${strong ? "font-semibold" : ""}`}
    >
      {children}
    </td>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="py-6 text-center text-[13px] text-ink-subtlest">{children}</div>;
}
