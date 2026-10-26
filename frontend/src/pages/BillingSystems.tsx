import { Pencil, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { BillingData as Data, ChargeRow } from "../api/client";
import { money } from "../lib/format";
import { BILLED, NONE, partIn, Pill, sharesOf, useChargeEditor } from "./BillingCharge";
import { monthName, monthOf, pct, rm, TH } from "./BillingStatements";

// The Overview tab of System billing: every system side by side, then one sub-tab per
// system listing what it pays for. Money paid comes from the Statements tab (ringgit, by
// month, matched by Sheet ID); fixed plans come from each charge's latest bill. A shared
// charge counts towards each system by its share.

const UNMATCHED = "unmatched";
const prevMonth = (m: string) => {
  const d = new Date(`${m}-01T00:00:00`);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const live = (c: ChargeRow) => c.status !== "cancelled";
const isUse = (c: ChargeRow) => c.billed === "credit" || c.billed === "usage";

// Latest bill as a monthly amount: yearly ones spread over 12 months.
function fixedPerMonth(c: ChargeRow) {
  if (!live(c) || c.amount === null) return { usd: 0, myr: 0 };
  const a = c.billed === "monthly" ? c.amount : c.billed === "yearly" ? c.amount / 12 : 0;
  return c.currency === "MYR" ? { usd: 0, myr: a } : { usd: a, myr: 0 };
}

function Fixed({ usd, myr }: { usd: number; myr: number }) {
  if (!usd && !myr) return <>-</>;
  return (
    <>
      {usd > 0 && money(usd)}
      {myr > 0 && <div className={usd > 0 ? "text-[11px] text-ink-subtle" : ""}>{usd > 0 ? "+ " : ""}{money(myr, "MYR")}</div>}
    </>
  );
}

function Change({ now, before }: { now: number; before: number }) {
  if (!before || !now) return <span className="text-ink-subtlest">-</span>;
  const ch = Math.round((now / before - 1) * 1000) / 10;
  return <span className={ch > 0 ? "text-loz-red-ink" : "text-loz-green-ink"}>{`${ch > 0 ? "+" : ""}${ch}%`}</span>;
}

function Tile({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  return (
    <div className="card p-4">
      <span className="section-title">{label}</span>
      <div className="mt-2 text-[22px] font-extrabold tabular-nums text-ink">{value}</div>
      <div className="text-xs text-ink-subtle">{note}</div>
    </div>
  );
}

export function SystemsOverview({ data, setData, canEdit }: { data: Data; setData: (d: Data) => void; canEdit: boolean }) {
  const [params, setParams] = useSearchParams();
  const views = [...data.systems.map((s) => [s.code, s.name] as const), [NONE, "No system yet"] as const];
  const view = views.find(([k]) => k === params.get("system"))?.[0] ?? "";
  const pick = (v: string) => setParams(v ? { tab: "overview", system: v } : { tab: "overview" }, { replace: true });

  const months = [...new Set(data.lines.map((l) => monthOf(l.txnDate)))].sort().reverse();
  const [month, setMonth] = useState(months[0] ?? new Date().toISOString().slice(0, 7));
  const before = prevMonth(month);

  const byRegister = new Map(data.charges.filter((c) => c.registerId).map((c) => [c.registerId, c]));
  // Paid on the cards for one charge in one month, before any share is applied.
  const paidByCharge = new Map<string, number>();
  let unmatched = 0;
  let unmatchedBefore = 0;
  let unmatchedLines = 0;
  for (const l of data.lines) {
    const m = monthOf(l.txnDate);
    if (m !== month && m !== before) continue;
    const c = byRegister.get(l.registerId);
    if (!c) {
      if (m === month) {
        unmatched += l.amountMyr;
        unmatchedLines += 1;
      } else unmatchedBefore += l.amountMyr;
      continue;
    }
    const k = `${c.id}|${m}`;
    paidByCharge.set(k, (paidByCharge.get(k) ?? 0) + l.amountMyr);
  }
  const paid = (c: ChargeRow, m: string) => paidByCharge.get(`${c.id}|${m}`) ?? 0;

  const totalsFor = (code: string) => {
    const t = { services: 0, open: 0, paid: 0, before: 0, use: 0, usd: 0, myr: 0 };
    for (const c of data.charges) {
      const part = partIn(c, code);
      if (!part) continue;
      if (live(c)) t.services += 1;
      if (c.status === "to_confirm" || c.status === "to_fill_in") t.open += 1;
      t.paid += paid(c, month) * part;
      t.before += paid(c, before) * part;
      if (isUse(c)) t.use += paid(c, month) * part;
      const f = fixedPerMonth(c);
      t.usd += f.usd * part;
      t.myr += f.myr * part;
    }
    return t;
  };

  const { open, editor } = useChargeEditor(data, setData);

  return (
    <>
      <div role="tablist" aria-label="System" className="mt-4 flex flex-wrap gap-1.5">
        {[["", "All systems"] as const, ...views].map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={view === k}
            onClick={() => pick(k)}
            className={`tap rounded-full border px-3 py-1 text-[12.5px] font-semibold ${
              view === k ? "border-primary bg-primary text-surface" : "border-line text-ink-subtle hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className="input" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {months.length === 0 && <option value={month}>{monthName(month)}</option>}
          {months.map((m) => (
            <option key={m} value={m}>
              {monthName(m)}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-subtle">Paid = card statement lines that month. Fixed = latest bills, yearly ones ÷ 12.</span>
      </div>

      {view === "" ? (
        <AllSystems data={data} month={month} totalsFor={totalsFor} unmatched={{ now: unmatched, before: unmatchedBefore, lines: unmatchedLines }} pick={pick} />
      ) : (
        <OneSystem
          data={data}
          code={view}
          month={month}
          t={totalsFor(view)}
          paid={paid}
          before={before}
          canEdit={canEdit}
          open={open}
        />
      )}
      {editor}
    </>
  );
}

type T = { services: number; open: number; paid: number; before: number; use: number; usd: number; myr: number };

function AllSystems(props: {
  data: Data;
  month: string;
  totalsFor: (code: string) => T;
  unmatched: { now: number; before: number; lines: number };
  pick: (v: string) => void;
}) {
  const { data, month, totalsFor, unmatched, pick } = props;
  const rows = [...data.systems.map((s) => ({ code: s.code, name: s.name })), { code: NONE, name: "No system yet" }].map((r) => ({
    ...r,
    t: totalsFor(r.code),
  }));
  const all = rows.reduce(
    (a, r) => ({
      services: a.services + r.t.services,
      open: a.open + r.t.open,
      paid: a.paid + r.t.paid,
      before: a.before + r.t.before,
      use: a.use + r.t.use,
      usd: a.usd + r.t.usd,
      myr: a.myr + r.t.myr,
    }),
    { services: 0, open: 0, paid: unmatched.now, before: unmatched.before, use: 0, usd: 0, myr: 0 },
  );
  // A shared charge shows in several rows, so count services once here.
  const services = data.charges.filter(live).length;
  const noSystem = data.charges.filter((c) => partIn(c, NONE) > 0).length;

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={`Paid in ${monthName(month)}`} value={rm(all.paid)} note="on the company cards" />
        <Tile label="Fixed plans" value={<Fixed usd={all.usd} myr={all.myr} />} note="a month, from latest bills" />
        <Tile label="Per credit / per use" value={rm(all.use)} note={`paid in ${monthName(month)}, ${pct(all.use, all.paid)} of the month`} />
        <Tile label="Needs a system" value={`${noSystem} · ${unmatched.lines}`} note="charges with no system · statement lines not matched" />
      </div>

      <section className="mt-6" aria-label="By system">
        <h2 className="section-title">By system</h2>
        <div className="card mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["System", "Services", `Paid ${monthName(month)}`, "Month before", "Change", "Fixed a month", "Per credit / use", "To confirm"].map((h, i) => (
                  <th key={h} className={`${TH} whitespace-nowrap ${i ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ code, name, t }) => (
                <tr key={code} className="border-b border-line-subtle last:border-0">
                  <td className={`px-3 py-2 pl-4 font-medium ${code === NONE ? "text-loz-orange-ink" : "text-ink"}`}>
                    <button className="text-left hover:underline" onClick={() => pick(code)}>
                      {name}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.services}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{rm(t.paid)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-subtle">{rm(t.before)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <Change now={t.paid} before={t.before} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    <Fixed usd={t.usd} myr={t.myr} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rm(t.use)}</td>
                  <td className="px-3 py-2 pr-4 text-right tabular-nums">{t.open || "-"}</td>
                </tr>
              ))}
              <tr className="border-b border-line-subtle">
                <td className="px-3 py-2 pl-4 text-loz-orange-ink">Statement lines not matched</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-subtle">{unmatched.lines || "-"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{rm(unmatched.now)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-subtle">{rm(unmatched.before)}</td>
                <td colSpan={4} className="px-3 py-2 pr-4 text-right text-xs text-ink-subtle">
                  Match them on the Statements tab
                </td>
              </tr>
              <tr className="bg-surface-dim font-bold">
                <td className="px-3 py-2 pl-4 text-ink">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{services}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rm(all.paid)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rm(all.before)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <Change now={all.paid} before={all.before} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  <Fixed usd={all.usd} myr={all.myr} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rm(all.use)}</td>
                <td className="px-3 py-2 pr-4 text-right tabular-nums">{data.charges.filter((c) => c.status === "to_confirm" || c.status === "to_fill_in").length}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function OneSystem(props: {
  data: Data;
  code: string;
  month: string;
  before: string;
  t: T;
  paid: (c: ChargeRow, m: string) => number;
  canEdit: boolean;
  open: (c: ChargeRow | "new", preset?: Partial<Pick<ChargeRow, "systemCode">>) => void;
}) {
  const { data, code, month, before, t, paid, canEdit, open } = props;
  const rows = data.charges
    .filter((c) => partIn(c, code) > 0)
    .sort((a, b) => paid(b, month) * partIn(b, code) - paid(a, month) * partIn(a, code) || a.vendor.localeCompare(b.vendor));

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={`Paid in ${monthName(month)}`} value={rm(t.paid)} note={t.before ? `${rm(t.before)} the month before` : "nothing the month before"} />
        <Tile label="Fixed plans" value={<Fixed usd={t.usd} myr={t.myr} />} note="a month, this system's share" />
        <Tile label="Per credit / per use" value={rm(t.use)} note={`paid in ${monthName(month)}`} />
        <Tile label="Services" value={String(t.services)} note={t.open ? `${t.open} still to confirm` : "all confirmed or closed"} />
      </div>

      <div className="mt-6 flex items-center">
        <h2 className="section-title">{code === NONE ? "Charges with no system yet" : "What it pays for"}</h2>
        {canEdit && code !== NONE && (
          <button className="btn-default ml-auto h-8 px-3" onClick={() => open("new", { systemCode: code })}>
            <Plus className="h-3.5 w-3.5" /> Add charge
          </button>
        )}
      </div>
      {code === NONE && rows.length > 0 && (
        <p className="mt-1 text-[12.5px] text-ink-subtle">Open each one and pick its system, or "Shared, split by %" when several systems use it.</p>
      )}
      {rows.length === 0 && <div className="py-12 text-center text-sm text-ink-subtle">Nothing here.</div>}
      {rows.length > 0 && (
        <div className="card mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["Third-party app", "Project / API ID", "Module", "Billing", monthName(month), monthName(before), "Latest bill", "Status", ""].map((h, i) => (
                  <th key={i} className={`${TH} whitespace-nowrap ${i >= 4 && i <= 6 ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const part = partIn(c, code);
                const shared = sharesOf(c).length > 1;
                return (
                  <tr key={c.id} className="border-b border-line-subtle align-top last:border-0">
                    <td className="px-3 py-2.5 pl-4">
                      <div className="font-medium text-ink">
                        {c.vendor} <span className="text-xs font-normal text-ink-subtlest">{c.registerId}</span>
                      </div>
                      {c.usedFor && <div className="max-w-xs text-xs text-ink-subtlest">{c.usedFor}</div>}
                    </td>
                    <td className="max-w-[220px] px-3 py-2.5">
                      <div className="break-words text-ink">{c.projectRef || <span className="text-ink-subtlest">Not set</span>}</div>
                      {c.keyName && <div className="break-words text-xs text-ink-subtlest">{c.keyName}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-ink-subtle">{c.module || "Whole system"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-subtle">
                      {BILLED[c.billed]}
                      {shared && <div className="text-xs text-ink-subtlest">{Math.round(part * 1000) / 10}% share</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">{paid(c, month) ? rm(paid(c, month) * part) : "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-subtle">{paid(c, before) ? rm(paid(c, before) * part) : "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                      {c.amount === null ? "-" : money(c.amount, c.currency)}
                      {shared && c.amount !== null && <div className="text-xs text-ink-subtlest">share {money(c.amount * part, c.currency)}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill status={c.status} />
                    </td>
                    <td className="w-12 px-3 py-2.5 pr-4 text-right">
                      {canEdit && (
                        <button className="btn-subtle h-8 w-8 px-0" title="Edit" aria-label={`Edit ${c.registerId} ${c.vendor}`} onClick={() => open(c)}>
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
