import { ChevronDown, ChevronRight, Download, Pencil, Plus } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api, json, type BillingData as Data, type ChargeRow } from "../api/client";
import { fmtAgo, money } from "../lib/format";
import { BILLED, moduleLabel, moduleShares, NONE, partIn, Pill, sharesOf, useChargeEditor } from "./BillingCharge";
import { monthName, monthOf, pct, rm, TH } from "./BillingStatements";

// The Overview tab of System billing: every system side by side, then one sub-tab per
// system listing what it pays for. Money paid comes from the Statements tab (ringgit, by
// month, matched by Sheet ID); fixed plans come from each charge's latest bill. A shared
// charge counts towards each system by its share.

const UNMATCHED = "unmatched";
const MIN_SHARE = 0.01; // below 1% a charge is not counted as one of a system's services
const prevMonth = (m: string) => {
  const d = new Date(`${m}-01T00:00:00`);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const live = (c: ChargeRow) => c.status !== "cancelled";
const isUse = (c: ChargeRow) => c.billed === "credit" || c.billed === "usage";

// Latest bill as a monthly amount: yearly ones spread over 12 months.
export function fixedPerMonth(c: ChargeRow) {
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
      const part = partIn(c, code, data, month);
      const partBefore = partIn(c, code, data, before);
      if (!part && !partBefore) continue;
      // A sliver of a usage split (e.g. 0.1% from a workspace with no system) still counts as
      // money, but does not make the charge one of this system's services.
      const counts = part >= MIN_SHARE;
      if (counts && live(c)) t.services += 1;
      if (counts && (c.status === "to_confirm" || c.status === "to_fill_in")) t.open += 1;
      t.paid += paid(c, month) * part;
      t.before += paid(c, before) * partBefore;
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
        <button
          className="btn-default ml-auto h-8 px-3"
          title={`Download ${monthName(month)} as an Excel file: summary, by vendor, charges, AI usage, invoices and statement lines`}
          onClick={() =>
            void import("./billingExport").then(({ downloadBillingExport }) =>
              downloadBillingExport({ data, month, before, paid, totalsFor, unmatched: { now: unmatched, before: unmatchedBefore, lines: unmatchedLines } }),
            )
          }
        >
          <Download className="h-3.5 w-3.5" /> Export to Excel
        </button>
      </div>

      {view === "" ? (
        <>
          <AllSystems data={data} month={month} totalsFor={totalsFor} unmatched={{ now: unmatched, before: unmatchedBefore, lines: unmatchedLines }} pick={pick} />
          <AiUsage data={data} setData={setData} month={month} canEdit={canEdit} />
        </>
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

export type T = { services: number; open: number; paid: number; before: number; use: number; usd: number; myr: number };
export type Unmatched = { now: number; before: number; lines: number };

// The All systems figures, shared by the page and the Excel export so the two agree.
export function allSystemsOf(data: Data, month: string, totalsFor: (code: string) => T, unmatched: Unmatched) {
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
  const noSystem = data.charges.filter((c) => partIn(c, NONE, data, month) >= MIN_SHARE).length;
  // Checked = the line has its invoice, or a person checked it by hand.
  const withInvoice = new Set(data.invoices.map((i) => i.statementLineId));
  const notChecked = data.lines.filter((l) => monthOf(l.txnDate) === month && !withInvoice.has(l.id) && !l.checkedByHand).length;
  const toConfirm = data.charges.filter((c) => c.status === "to_confirm" || c.status === "to_fill_in").length;
  return { rows, all, services, noSystem, notChecked, toConfirm };
}

function AllSystems(props: {
  data: Data;
  month: string;
  totalsFor: (code: string) => T;
  unmatched: Unmatched;
  pick: (v: string) => void;
}) {
  const { data, month, totalsFor, unmatched, pick } = props;
  const { rows, all, services, noSystem, notChecked, toConfirm } = allSystemsOf(data, month, totalsFor, unmatched);

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={`Paid in ${monthName(month)}`} value={rm(all.paid)} note="on the company cards" />
        <Tile label="Fixed plans" value={<Fixed usd={all.usd} myr={all.myr} />} note="a month, from latest bills" />
        <Tile label="Per credit / per use" value={rm(all.use)} note={`paid in ${monthName(month)}, ${pct(all.use, all.paid)} of the month`} />
        <Tile
          label="Not checked"
          value={String(notChecked)}
          note={`statement lines in ${monthName(month)} with no invoice${noSystem ? ` · ${noSystem} charge(s) with no system` : ""}`}
        />
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
                <td className="px-3 py-2 pr-4 text-right tabular-nums">{toConfirm}</td>
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
  const [shown, setShown] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setShown((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const rows = data.charges
    .filter((c) => partIn(c, code, data, month) > 0 || partIn(c, code, data, before) > 0)
    .sort((a, b) => paid(b, month) * partIn(b, code, data, month) - paid(a, month) * partIn(a, code, data, month) || a.vendor.localeCompare(b.vendor));

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
      {code !== NONE && <UnusedProjects data={data} code={code} />}
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
                const part = partIn(c, code, data, month);
                const partBefore = partIn(c, code, data, before);
                const shared = sharesOf(c, data, month).length > 1;
                const detail = code === NONE ? null : detailOf(c, data, code, month);
                const isOpen = !!detail && shown.has(c.id);
                return (
                  <Fragment key={c.id}>
                  <tr
                    className={`align-top ${isOpen ? "" : "border-b border-line-subtle last:border-0"} ${detail ? "cursor-pointer hover:bg-surface-dim" : ""}`}
                    onClick={detail ? () => toggle(c.id) : undefined}
                  >
                    <td className="px-3 py-2.5 pl-4">
                      <div className="flex items-start gap-1 font-medium text-ink">
                        {detail ? (
                          <button
                            className="-ml-1 mt-px rounded text-ink-subtle hover:text-ink"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} usage for ${c.registerId} ${c.vendor}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle(c.id);
                            }}
                          >
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        ) : (
                          <span className="w-4 shrink-0" />
                        )}
                        <span>
                          {c.vendor} <span className="text-xs font-normal text-ink-subtlest">{c.registerId}</span>
                        </span>
                      </div>
                      {c.usedFor && <div className="max-w-xs pl-5 text-xs text-ink-subtlest">{c.usedFor}</div>}
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
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-subtle">{paid(c, before) ? rm(paid(c, before) * partBefore) : "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                      {c.amount === null ? "-" : money(c.amount, c.currency)}
                      {shared && c.amount !== null && <div className="text-xs text-ink-subtlest">share {money(c.amount * part, c.currency)}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill status={c.status} />
                    </td>
                    <td className="w-12 px-3 py-2.5 pr-4 text-right">
                      {canEdit && (
                        <button className="btn-subtle h-8 w-8 px-0" title="Edit" aria-label={`Edit ${c.registerId} ${c.vendor}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            open(c);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && detail && (
                    <tr className="border-b border-line-subtle last:border-0">
                      <td colSpan={9} className="px-3 pb-3 pl-9 pr-4">
                        <UsageDetail detail={detail} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// What one charge's money went on, for its dropdown in a system's table: credit split by
// usage goes by this system's modules (the vendor's real cost for the month, shared by the
// system's own log of its calls); anything else by project ID on its latest invoice.
type Detail = { title: string; rows: { key: string; label: ReactNode; sub: string; amount: string; share: string; dim: boolean }[]; note: string };

function detailOf(c: ChargeRow, data: Data, code: string, month: string): Detail | null {
  if (c.splitByUsage) {
    const cost = data.usage.filter((u) => u.vendor === c.vendor && u.month === month).reduce((a, u) => a + u.usd, 0);
    const mine = moduleShares(data, c.vendor, month).filter((s) => s.code === code && s.part > 0);
    if (!cost || !mine.length || (mine.length === 1 && mine[0]!.module === "")) return null;
    const calls = (module: string) =>
      data.moduleUsage.filter((m) => m.vendor === c.vendor && m.month === month && m.systemCode === code && m.module === module).reduce((a, m) => a + m.calls, 0);
    const whole = mine.reduce((a, s) => a + s.part, 0);
    return {
      title: `Usage by module, ${monthName(month)}`,
      rows: [...mine]
        .sort((a, b) => b.part - a.part)
        .map((s) => ({ key: s.module, label: moduleLabel(s.module), sub: s.module ? `${calls(s.module)} call(s)` : "", amount: money(cost * s.part), share: pct(s.part, whole), dim: false })),
      note: `${c.vendor}'s real cost so far this month, split by this system's own log of its calls. Paid money follows the card statements.`,
    };
  }
  const latest = data.invoices.find((i) => i.chargeId === c.id); // invoices come newest first
  if (!latest) return null;
  const byRef = new Map<string, number>();
  for (const l of data.invoiceLines) if (l.invoiceId === latest.id && l.projectRef && l.kind === "charge") byRef.set(l.projectRef, (byRef.get(l.projectRef) ?? 0) + l.amount);
  if (!byRef.size) return null;
  const part = partIn(c, code, data);
  const whole = [...byRef.values()].reduce((a, v) => a + v, 0);
  return {
    title: `Usage by project ID, invoice ${latest.invoiceNo}`,
    rows: [...byRef]
      .sort((a, b) => b[1] - a[1])
      .map(([ref, amount]) => {
        const r = data.projectRefs.find((x) => x.ref === ref);
        const inUse = r ? !!r.inUse : true;
        return {
          key: ref,
          label: (
            <>
              {r?.name || <span className="text-loz-orange-ink">Not named</span>}
              {!inUse && <span className="pill ml-2 bg-loz-grey text-loz-grey-ink">Not used</span>}
            </>
          ),
          sub: ref,
          amount: money(amount * part, latest.currency),
          share: pct(amount, whole),
          dim: !inUse,
        };
      }),
    note: `From the latest invoice, dated ${latest.invoiceDate}${part < 1 ? `, this system's ${pct(part, 1)} share` : ""}. Charges only; tax and discounts are left out.`,
  };
}

function UsageDetail({ detail }: { detail: Detail }) {
  return (
    <div className="max-w-3xl rounded-md border border-line-subtle px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{detail.title}</div>
      <table className="mt-1 w-full border-collapse text-[12.5px]">
        <tbody>
          {detail.rows.map((r) => (
            <tr key={r.key} className={`border-b border-line-subtle last:border-0 ${r.dim ? "text-ink-subtlest" : ""}`}>
              <td className="py-1.5 pr-3">
                <div className={r.dim ? "" : "text-ink"}>{r.label}</div>
                {r.sub && <div className="font-mono text-[11px] text-ink-subtlest">{r.sub}</div>}
              </td>
              <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">{r.amount}</td>
              <td className="w-16 whitespace-nowrap py-1.5 text-right tabular-nums text-ink-subtle">{r.share}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-ink-subtlest">{detail.note}</p>
    </div>
  );
}

// Projects marked not in use on this system's latest invoices, added up above the table so
// their cost stays in sight until they are deleted at the vendor.
function UnusedProjects({ data, code }: { data: Data; code: string }) {
  const costs: string[] = [];
  for (const c of data.charges.filter((x) => partIn(x, code, data) > 0)) {
    const latest = data.invoices.find((i) => i.chargeId === c.id);
    if (!latest) continue;
    for (const l of data.invoiceLines) {
      if (l.invoiceId !== latest.id || !l.projectRef || l.kind !== "charge") continue;
      const r = data.projectRefs.find((x) => x.ref === l.projectRef);
      if (r && !r.inUse) costs.push(money(l.amount * partIn(c, code, data), latest.currency));
    }
  }
  if (!costs.length) return null;
  return (
    <p className="mt-1 text-[12.5px] text-loz-orange-ink">
      {costs.length} project line(s) not in use cost {costs.join(" + ")} on their latest invoice. Open the arrow on the charge to see which, and delete them at the vendor to stop paying.
    </p>
  );
}

// Anthropic's cost per workspace for the month, as read from its cost report, and the
// system each workspace is for. Charges set to "Split by usage" are shared by these.
function AiUsage({ data, setData, month, canEdit }: { data: Data; setData: (d: Data) => void; month: string; canEdit: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ws = data.workspaces.filter((w) => w.vendor === "Anthropic");
  const usdOf = (id: string) => data.usage.filter((u) => u.vendor === "Anthropic" && u.month === month && u.workspaceId === id).reduce((a, u) => a + u.usd, 0);
  const total = ws.reduce((a, w) => a + usdOf(w.workspaceId), 0);
  const used = data.charges.some((c) => c.splitByUsage);
  if (!used && !ws.length) return null;
  const systemName = (code: string) => data.systems.find((s) => s.code === code)?.name ?? code;

  // The workspace's cost shared by its system's own module estimates for the month.
  const moduleRows = (w: (typeof ws)[number]) => {
    const est = data.moduleUsage.filter((m) => m.vendor === "Anthropic" && m.sourceSystem === w.systemCode && m.month === month);
    const estTotal = est.reduce((a, m) => a + m.usd, 0);
    const cost = usdOf(w.workspaceId);
    if (!w.systemCode || estTotal <= 0) return [];
    const last = est.reduce((a, m) => (a > m.receivedAt ? a : m.receivedAt), "");
    return [
      ...[...est]
        .sort((a, b) => b.usd - a.usd)
        .map((m) => (
          <tr key={`${w.workspaceId}|${m.systemCode}|${m.module}`} className="border-b border-line-subtle text-[12.5px] last:border-0">
            <td className="px-3 py-1.5 pl-10 text-ink-subtle">{moduleLabel(m.module)}</td>
            <td className="px-3 py-1.5 text-ink-subtlest">
              {systemName(m.systemCode)} · {m.calls} call(s)
            </td>
            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-ink-subtle">{money((cost * m.usd) / estTotal)}</td>
            <td className="px-3 py-1.5 pr-4 text-right tabular-nums text-ink-subtlest">{pct(m.usd, estTotal)}</td>
          </tr>
        )),
      <tr key={`${w.workspaceId}|note`} className="border-b border-line-subtle last:border-0">
        <td colSpan={4} className="px-3 py-1.5 pl-10 text-[11px] text-ink-subtlest">
          Split by {systemName(w.systemCode)}'s own log of its AI calls, last sent {fmtAgo(last)}. The total is Anthropic's real cost.
        </td>
      </tr>,
    ];
  };

  const refresh = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ workspaces: number; days: number }>("/billing/usage/refresh", { method: "POST" });
      setData(await api<Data>("/billing"));
      setMsg({ ok: true, text: `Read ${r.days} day(s) of cost across ${r.workspaces} workspace(s).` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const setSystem = async (workspaceId: string, systemCode: string) => {
    await api("/billing/workspaces", json("PATCH", { vendor: "Anthropic", workspaceId, systemCode }));
    setData(await api<Data>("/billing"));
  };

  return (
    <section className="mt-6" aria-label="AI usage">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title">AI usage by workspace (Anthropic)</h2>
        <span className="text-xs text-ink-subtle">{data.usageSyncedAt ? `read ${fmtAgo(data.usageSyncedAt)}` : "not read yet"} · read every day at 10:00</span>
        {canEdit && (
          <button className="btn-default ml-auto h-8 px-3" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Reading..." : "Read now"}
          </button>
        )}
      </div>
      <p className="mt-1 text-[12.5px] text-ink-subtle">
        Anthropic credit set to "Split by usage" is shared between the systems by these amounts each month. Each system uses its own workspace.
      </p>
      {msg && (
        <div role="alert" className={`mt-2 rounded px-3 py-2 text-[12.5px] ${msg.ok ? "bg-loz-green text-loz-green-ink" : "bg-loz-red text-loz-red-ink"}`}>
          {msg.text}
        </div>
      )}
      {ws.length > 0 && (
        <div className="card mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["Workspace", "System", `Cost ${monthName(month)}`, "Share"].map((h, i) => (
                  <th key={h} className={`${TH} whitespace-nowrap ${i >= 2 ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ws.map((w) => (
                <tr key={w.workspaceId} className="border-b border-line-subtle last:border-0">
                  <td className="px-3 py-2 pl-4">
                    <div className="text-ink">{w.name}</div>
                    <div className="font-mono text-[11px] text-ink-subtlest">{w.workspaceId || "default workspace"}</div>
                  </td>
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <select className="input h-8" aria-label={`System for ${w.name}`} value={w.systemCode} onChange={(e) => void setSystem(w.workspaceId, e.target.value)}>
                        <option value="">Not set</option>
                        {data.systems.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (data.systems.find((s) => s.code === w.systemCode)?.name ?? "Not set")
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(usdOf(w.workspaceId))}</td>
                  <td className="px-3 py-2 pr-4 text-right tabular-nums text-ink-subtle">{pct(usdOf(w.workspaceId), total)}</td>
                </tr>
              )).flatMap((row, i) => [row, ...moduleRows(ws[i]!)])}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
