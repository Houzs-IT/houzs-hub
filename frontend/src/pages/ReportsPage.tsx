import { useEffect, useState } from "react";
import { api, type DailyStats, type MonthlyStats, type TicketType } from "../api/client";
import { TypeIcon } from "../components/Bits";
import { useHub } from "../components/Layout";
import { TYPES, TYPE_LABEL } from "../lib/labels";
import { useFilters } from "../lib/useFilters";

const RANGES = [6, 12, 24];
const BAR_COLOR: Record<TicketType, string> = { bug: "var(--chart-bug)", development: "var(--chart-dev)" };

const shortMonth = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
const longMonth = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const longDay = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

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
  const daily = filters.get("months") === "this";
  const months = RANGES.includes(Number(filters.get("months"))) ? Number(filters.get("months")) : 12;
  const tableType: TicketType = filters.get("type") === "development" ? "development" : "bug";
  const [data, setData] = useState<MonthlyStats | null>(null);
  const [dayData, setDayData] = useState<DailyStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const load = daily
      ? api<DailyStats>("/tickets/daily").then(setDayData)
      : api<MonthlyStats>(`/tickets/monthly?months=${months}`).then(setData);
    load.then(() => setError(null)).catch((e: Error) => setError(e.message));
  }, [daily, months, version]);

  const loaded = daily ? dayData : data;
  const keys = (daily ? dayData?.days : data?.months) ?? [];
  const rows = (daily ? (dayData?.rows ?? []).map((r) => ({ ...r, key: r.day })) : (data?.rows ?? []).map((r) => ({ ...r, key: r.month }))).filter(
    (r) => !system || r.system === system,
  );
  const count = (key: string, type: TicketType, sys?: string) =>
    rows.filter((r) => r.key === key && r.type === type && (!sys || r.system === sys)).reduce((sum, r) => sum + r.n, 0);
  const series = keys.map((k) => ({ key: k, bug: count(k, "bug"), development: count(k, "development") }));
  const ticks = axisTicks(Math.max(0, ...series.flatMap((s) => [s.bug, s.development])));
  const top = ticks.at(-1)!;
  const tableSystems = systems.filter((s) => (system ? s.code === system : true));
  const longLabel = daily ? longDay : longMonth;

  const thisMonth = series.at(-1);
  const lastMonth = series.at(-2);
  const monthBefore = series.at(-3);

  const today = dayData?.today ?? "";
  const todayAt = series.findIndex((s) => s.key === today);
  const monthTotal = (type: TicketType) => series.reduce((sum, s) => sum + s[type], 0);

  return (
    <div className="h-full overflow-auto px-4 py-6 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="eyebrow">Houzs Hub · Reports</div>
        <h1 className="mt-1 text-[20px] font-extrabold tracking-tight text-ink sm:text-[24px]">
          {daily ? `Bugs and development in ${today ? longMonth(today.slice(0, 7)) : "this month"}` : "Bugs and development by month"}
        </h1>
        <p className="mt-1 text-[13px] text-ink-subtle">
          Tickets counted on the {daily ? "day" : "month"} they were submitted (Malaysia time), by their current type. Change a ticket's type on
          the ticket and it moves here too.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            className="input"
            aria-label="System"
            value={system ?? ""}
            onChange={(e) => filters.set({ system: e.target.value || null })}
          >
            <option value="">All systems</option>
            {systems.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="inline-flex rounded-[9px] border border-line bg-surface p-1 shadow-stone">
            {(["this", ...RANGES] as const).map((r) => {
              const on = r === "this" ? daily : !daily && months === r;
              return (
                <button
                  key={r}
                  aria-pressed={on}
                  onClick={() => filters.set({ months: r === 12 ? null : String(r) })}
                  className={`tap rounded px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                    on ? "bg-primary text-primary-on shadow-sm" : "text-ink-subtle hover:bg-primary-soft hover:text-primary"
                  }`}
                >
                  {r === "this" ? "This month" : `${r} months`}
                </button>
              );
            })}
          </div>
        </div>

        {error && <div className="mt-4 rounded-md bg-loz-red px-3 py-2 text-[13px] text-loz-red-ink">{error}</div>}

        {loaded && (
          <>
            {daily ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {todayAt >= 0 && (
                  <Tile
                    label="Bugs today"
                    value={series[todayAt].bug}
                    note={todayAt > 0 ? compare(series[todayAt].bug, series[todayAt - 1].bug, "yesterday") : undefined}
                  />
                )}
                <Tile label={`Bugs in ${shortMonth(today.slice(0, 7))} so far`} value={monthTotal("bug")} />
                <Tile label={`Development in ${shortMonth(today.slice(0, 7))} so far`} value={monthTotal("development")} />
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {lastMonth && (
                  <Tile
                    label={`Bugs in ${shortMonth(lastMonth.key)}`}
                    value={lastMonth.bug}
                    note={monthBefore ? compare(lastMonth.bug, monthBefore.bug, shortMonth(monthBefore.key)) : undefined}
                  />
                )}
                {thisMonth && <Tile label={`Bugs in ${shortMonth(thisMonth.key)} so far`} value={thisMonth.bug} />}
                {thisMonth && <Tile label={`Development in ${shortMonth(thisMonth.key)} so far`} value={thisMonth.development} />}
              </div>
            )}

            <section className="card mt-4 p-4 md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="section-title">Tickets per {daily ? "day" : "month"}</h2>
                <div className="flex items-center gap-4 text-[12px] text-ink-subtle">
                  {TYPES.map((type) => (
                    <span key={type} className="flex items-center gap-1.5">
                      <TypeIcon type={type} size={14} />
                      {TYPE_LABEL[type]}
                    </span>
                  ))}
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
                          aria-label={`${longLabel(s.key)}: ${s.bug} bug, ${s.development} development`}
                          onMouseEnter={() => setHovered(i)}
                          onMouseLeave={() => setHovered(null)}
                          onFocus={() => setHovered(i)}
                          onBlur={() => setHovered(null)}
                          onClick={() => setHovered(i)}
                          className={`relative flex flex-1 items-end justify-center gap-[2px] rounded-sm outline-none ${hovered === i ? "bg-surface-2" : ""}`}
                        >
                          {TYPES.map((type) => (
                            <div
                              key={type}
                              className="w-full max-w-[14px] rounded-t-[4px]"
                              style={{ height: `${(s[type] / top) * 100}%`, background: BAR_COLOR[type] }}
                            />
                          ))}
                          {hovered === i && (
                            <div
                              className={`pointer-events-none absolute bottom-full z-10 mb-1 w-max rounded-md border border-line bg-overlay px-2.5 py-1.5 text-[12px] shadow-overlay ${
                                i < series.length / 2 ? "left-0" : "right-0"
                              }`}
                            >
                              <div className="font-semibold text-ink">{longLabel(s.key)}</div>
                              {TYPES.map((type) => (
                                <div key={type} className="flex items-center gap-1.5 text-ink-subtle">
                                  <TypeIcon type={type} size={12} />
                                  {TYPE_LABEL[type]}
                                  <span className="ml-auto pl-3 font-semibold tabular-nums text-ink">{s[type]}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex pt-1.5">
                    {series.map((s, i) => (
                      <div key={s.key} className="flex-1 text-center text-[10.5px] leading-tight text-ink-subtlest">
                        {daily ? (
                          // Every day fits on desktop; on a phone only 1, 5, 10, ... and today, minus any that would touch today's.
                          <span
                            className={`${i === todayAt || ((i === 0 || (i + 1) % 5 === 0) && Math.abs(i - todayAt) > 1) ? "" : "hidden sm:inline"} ${
                              i === todayAt ? "font-bold text-ink" : i > todayAt ? "opacity-50" : ""
                            }`}
                          >
                            {i + 1}
                          </span>
                        ) : months <= 12 ? (
                          <>
                            {shortMonth(s.key)}
                            {(i === 0 || s.key.endsWith("-01")) && <div>{s.key.slice(0, 4)}</div>}
                          </>
                        ) : (
                          i % 3 === 0 && `${shortMonth(s.key)} ${s.key.slice(2, 4)}`
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="card mt-4 p-4 md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="section-title">{TYPE_LABEL[tableType]} tickets per system</h2>
                <div className="inline-flex rounded-[9px] border border-line bg-surface p-1">
                  {TYPES.map((type) => (
                    <button
                      key={type}
                      aria-pressed={tableType === type}
                      onClick={() => filters.set({ type: type === "bug" ? null : type })}
                      className={`tap rounded px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                        tableType === type ? "bg-primary text-primary-on shadow-sm" : "text-ink-subtle hover:bg-primary-soft hover:text-primary"
                      }`}
                    >
                      {TYPE_LABEL[type]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[13px] tabular-nums">
                  <thead>
                    <tr className="text-[11px] text-ink-subtle">
                      <th className="sticky left-0 bg-surface py-1.5 pr-3 text-left font-semibold">System</th>
                      {keys.map((k) => (
                        <th key={k} className={`whitespace-nowrap px-2 py-1.5 text-right font-semibold ${k === today ? "text-ink" : ""}`}>
                          {daily ? Number(k.slice(8)) : `${shortMonth(k)} ${k.slice(2, 4)}`}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...tableSystems.map((s) => ({ code: s.code, name: s.name })), ...(tableSystems.length > 1 ? [{ code: "", name: "All systems" }] : [])].map(
                      (s) => {
                        const cells = keys.map((m) => count(m, tableType, s.code || undefined));
                        return (
                          <tr key={s.code || "all"} className={`border-t border-line-subtle ${s.code ? "" : "font-semibold"}`}>
                            <td className="sticky left-0 whitespace-nowrap bg-surface py-1.5 pr-3 text-ink">{s.name}</td>
                            {cells.map((n, i) => (
                              <td key={keys[i]} className={`px-2 py-1.5 text-right ${n ? "text-ink" : "text-ink-disabled"}`}>
                                {n}
                              </td>
                            ))}
                            <td className="px-2 py-1.5 text-right text-ink">{cells.reduce((a, b) => a + b, 0)}</td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function compare(now: number, before: number, beforeLabel: string) {
  if (now === before) return `Same as ${beforeLabel}`;
  return now < before ? `${before - now} fewer than ${beforeLabel} (${before})` : `${now - before} more than ${beforeLabel} (${before})`;
}

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[12px] text-ink-subtle">{label}</div>
      <div className="mt-0.5 text-[26px] font-extrabold tabular-nums text-ink">{value}</div>
      {note && <div className="text-[12px] text-ink-subtle">{note}</div>}
    </div>
  );
}
