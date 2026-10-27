import { Pencil, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api, json, type BillingData as Data, type CardRow, type ChargeRow, type ChargeStatus, type Perm } from "../api/client";
import { BILLED, NO_CARD, NONE, partIn, Pill, STATUS, STATUS_ORDER, systemLabel, useChargeEditor } from "./BillingCharge";
import { EditDialog, Field } from "../components/EditForm";
import { money } from "../lib/format";
import { useHub } from "../components/Layout";
import AccountsPage from "./AccountsPage";
import { Invoices } from "./BillingInvoices";
import { Monthly, Statements, Trend } from "./BillingStatements";
import { SystemsOverview } from "./BillingSystems";

const BILLING_TABS = [
  ["overview", "Overview"],
  ["register", "Register"],
  ["cards", "Cards"],
  ["statements", "Statements"],
  ["invoices", "Invoices"],
  ["monthly", "Monthly"],
  ["trend", "Trend"],
  ["accounts", "Account ownership"],
] as const;
type Tab = (typeof BILLING_TABS)[number][0];
// A blank card is "we don't know yet", which is not the same as "paid without a card".
const UNKNOWN_CARD = "Card not known";
const cardOf = (c: ChargeRow) => c.card || UNKNOWN_CARD;

type Totals = { services: number; confirmed: number; open: number; monthly: number; yearly: number; myrMonthly: number; myrYearly: number };

// Same rules as the sheet's Overview: every listed charge counts except cancelled ones.
function totals(rows: ChargeRow[]): Totals {
  const t: Totals = { services: rows.length, confirmed: 0, open: 0, monthly: 0, yearly: 0, myrMonthly: 0, myrYearly: 0 };
  for (const r of rows) {
    if (r.status === "confirmed") t.confirmed += 1;
    if (r.status === "to_confirm" || r.status === "to_fill_in") t.open += 1;
    if (r.status === "cancelled" || r.amount === null) continue;
    const myr = r.currency === "MYR";
    if (r.billed === "monthly") myr ? (t.myrMonthly += r.amount) : (t.monthly += r.amount);
    if (r.billed === "yearly") myr ? (t.myrYearly += r.amount) : (t.yearly += r.amount);
  }
  return t;
}

const TH = "border-b-2 border-line bg-surface-dim px-3 py-2.5 text-[10px] font-bold uppercase tracking-brand text-ink-subtle first:pl-4 last:pr-4";

function Amount({ usd, myr }: { usd: number; myr: number }) {
  return (
    <>
      {money(usd)}
      {myr > 0 && <div className="text-[11px] text-ink-subtle">+ {money(myr, "MYR")}</div>}
    </>
  );
}

export default function BillingPage() {
  const { me } = useHub();
  const has = (...p: Perm[]) => p.some((x) => me.perms?.includes(x));
  const canEdit = has("billing_edit");
  const canBilling = has("billing_view", "billing_edit");
  // Account ownership keeps its own permissions: someone may see one tab and not the others.
  const tabs = BILLING_TABS.filter(([k]) => (k === "accounts" ? has("accounts_view", "accounts_edit") : canBilling));
  const [params, setParams] = useSearchParams();
  const tab = (tabs.find(([k]) => k === params.get("tab")) ?? tabs[0])?.[0] as Tab | undefined;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!canBilling) return;
    api<Data>("/billing")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [canBilling]);
  useEffect(load, [load]);

  return (
    <div className="h-full overflow-auto px-4 py-6 md:px-8">
      <div className="eyebrow">Houzs Hub · Finance</div>
      <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">System billing</h1>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-subtle">
        What each outside service costs and which company card pays for it. Amounts are each vendor's latest bill. Cards are kept
        by their last 4 digits only.
      </p>

      <div role="tablist" className="mt-4 flex gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap border-b border-line">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams({ tab: key }, { replace: true })}
            className={`tap -mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${
              tab === key ? "border-primary text-ink" : "border-transparent text-ink-subtle hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
          {error}
        </div>
      )}
      {tab === "accounts" && <AccountsPage />}
      {canBilling && tab !== "accounts" && !data && !error && <div className="py-16 text-center text-sm text-ink-subtle">Loading...</div>}

      {data && tab === "overview" && (
        <>
          <SystemsOverview data={data} setData={setData} canEdit={canEdit} />
          {!params.get("system") && <Overview data={data} />}
        </>
      )}
      {data && tab === "register" && <Register data={data} setData={setData} canEdit={canEdit} />}
      {data && tab === "cards" && <Cards data={data} setData={setData} canEdit={canEdit} />}
      {data && tab === "statements" && <Statements data={data} setData={setData} canEdit={canEdit} />}
      {data && tab === "invoices" && <Invoices data={data} setData={setData} canEdit={canEdit} />}
      {data && tab === "monthly" && <Monthly data={data} />}
      {data && tab === "trend" && <Trend data={data} />}
    </div>
  );
}

function Overview({ data }: { data: Data }) {
  const all = totals(data.charges);
  const companies = [...new Set(data.charges.map((c) => c.company || "No company"))].sort();
  const cardNames = [...new Set([...data.cards.map((c) => c.nickname), ...data.charges.map(cardOf)])];
  const byCard = cardNames
    .map((name) => ({ name, card: data.cards.find((c) => c.nickname === name), t: totals(data.charges.filter((c) => cardOf(c) === name)) }))
    .sort((a, b) => b.t.monthly + b.t.yearly - (a.t.monthly + a.t.yearly));

  return (
    <>
      <Section title="By company">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {["Company", "Services", "Confirmed", "To confirm", "Monthly", "Yearly"].map((h, i) => (
                <th key={h} className={`${TH} ${i ? "text-right" : "text-left"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {companies.map((co) => {
              const t = totals(data.charges.filter((c) => (c.company || "No company") === co));
              return <TotalsRow key={co} label={co} t={t} />;
            })}
            <TotalsRow label="Total" t={all} bold />
          </tbody>
        </table>
      </Section>

      <Section title="By card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {["Card", "Holder", "Services", "Monthly", "Yearly"].map((h, i) => (
                <th key={h} className={`${TH} ${i > 1 ? "text-right" : "text-left"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byCard.map(({ name, card, t }) => (
              <tr key={name} className="border-b border-line-subtle last:border-0">
                <td className="px-3 py-2 pl-4 font-medium text-ink">{name}</td>
                <td className="px-3 py-2 text-ink-subtle">{card?.holder || "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.services}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <Amount usd={t.monthly} myr={t.myrMonthly} />
                </td>
                <td className="px-3 py-2 pr-4 text-right tabular-nums">
                  <Amount usd={t.yearly} myr={t.myrYearly} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      <div className="card mt-2 overflow-x-auto">{children}</div>
    </section>
  );
}

function TotalsRow({ label, t, bold }: { label: string; t: Totals; bold?: boolean }) {
  return (
    <tr className={`border-b border-line-subtle last:border-0 ${bold ? "bg-surface-dim font-bold" : ""}`}>
      <td className="px-3 py-2 pl-4 text-ink">{label}</td>
      <td className="px-3 py-2 text-right tabular-nums">{t.services}</td>
      <td className="px-3 py-2 text-right tabular-nums">{t.confirmed}</td>
      <td className="px-3 py-2 text-right tabular-nums">{t.open}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        <Amount usd={t.monthly} myr={t.myrMonthly} />
      </td>
      <td className="px-3 py-2 pr-4 text-right tabular-nums">
        <Amount usd={t.yearly} myr={t.myrYearly} />
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Register: one row per bill line.

function Register({ data, setData, canEdit }: { data: Data; setData: (d: Data) => void; canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<ChargeStatus | "">("");
  const [card, setCard] = useState("");
  const [system, setSystem] = useState("");
  const { open, editor } = useChargeEditor(data, setData);
  const companies = useMemo(() => [...new Set(data.charges.map((c) => c.company).filter(Boolean))].sort(), [data.charges]);
  const cardNames = useMemo(
    () => [...new Set([...data.cards.map((c) => c.nickname), ...data.charges.map((c) => c.card).filter(Boolean)])].sort(),
    [data],
  );

  const needle = q.trim().toLowerCase();
  const shown = data.charges.filter(
    (c) =>
      (!company || c.company === company) &&
      (!status || c.status === status) &&
      (!card || cardOf(c) === card) &&
      (!system || partIn(c, system) > 0) &&
      (!needle ||
        [c.registerId, c.company, c.system, systemLabel(data, c), c.module, c.projectRef, c.vendor, c.serviceType, c.usedFor, c.plan, c.card, c.keyName, c.notes]
          .join(" ")
          .toLowerCase()
          .includes(needle)),
  );
  const t = totals(shown);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-subtlest" />
          <input className="input w-full pl-8" placeholder="Search charges" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company">
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select className="input" value={system} onChange={(e) => setSystem(e.target.value)} aria-label="System">
          <option value="">All systems</option>
          {data.systems.map((x) => (
            <option key={x.code} value={x.code}>
              {x.name}
            </option>
          ))}
          <option value={NONE}>No system yet</option>
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ChargeStatus | "")} aria-label="Status">
          <option value="">Any status</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </select>
        <select className="input" value={card} onChange={(e) => setCard(e.target.value)} aria-label="Card">
          <option value="">Any card</option>
          {[...cardNames.filter((c) => c !== NO_CARD), NO_CARD, UNKNOWN_CARD].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <span className="text-xs text-ink-subtle">
          {shown.length} of {data.charges.length} · {money(t.monthly)} a month · {money(t.yearly)} a year
        </span>
        {canEdit && (
          <button className="btn-primary ml-auto" onClick={() => open("new")}>
            <Plus className="h-4 w-4" /> Add charge
          </button>
        )}
      </div>

      {shown.length === 0 && <div className="py-12 text-center text-sm text-ink-subtle">No charges match.</div>}

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:hidden">
        {shown.map((c) => (
          <div key={c.id} className="card p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-ink">
                  {c.vendor} <span className="text-xs font-normal text-ink-subtlest">{c.registerId}</span>
                </div>
                <div className="text-xs text-ink-subtle">{[systemLabel(data, c), c.module, c.serviceType].filter(Boolean).join(" · ")}</div>
              </div>
              <Pill status={c.status} />
            </div>
            {c.usedFor && <div className="mt-2 text-[12.5px] text-ink-subtle">{c.usedFor}</div>}
            <div className="mt-2 text-[13px] text-ink">
              {c.amount === null ? "Amount not known" : money(c.amount, c.currency)}
              {c.billed && <span className="text-ink-subtle"> · {BILLED[c.billed]}</span>}
              <span className="text-ink-subtle"> · {c.card || "Card not known"}</span>
            </div>
            {canEdit && (
              <button className="btn-default mt-3 h-8 px-3" onClick={() => open(c)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
          </div>
        ))}
      </div>

      {shown.length > 0 && (
        <div className="card mt-3 hidden overflow-x-auto xl:block">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["ID", "Service", "Plan", "Latest bill", "Billed", "Card", "Status", "Last checked", ""].map((h, i) => (
                  <th key={i} className={`${TH} text-left`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="border-b border-line-subtle align-top last:border-0">
                  <td className="w-14 px-3 py-2.5 pl-4 font-medium text-ink-subtle">{c.registerId || "-"}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink">{c.vendor}</div>
                    <div className="text-xs text-ink-subtle">{[systemLabel(data, c), c.module, c.serviceType].filter(Boolean).join(" · ")}</div>
                    {c.usedFor && <div className="max-w-md text-xs text-ink-subtlest">{c.usedFor}</div>}
                  </td>
                  <td className="w-44 px-3 py-2.5 text-ink-subtle">{c.plan || "-"}</td>
                  <td className="w-28 px-3 py-2.5 tabular-nums text-ink">{c.amount === null ? "-" : money(c.amount, c.currency)}</td>
                  <td className="w-24 px-3 py-2.5 text-ink-subtle">{c.billed ? BILLED[c.billed] : "-"}</td>
                  <td className="w-28 px-3 py-2.5 text-ink-subtle">{c.card || "-"}</td>
                  <td className="w-28 px-3 py-2.5">
                    <Pill status={c.status} />
                  </td>
                  <td className="w-28 px-3 py-2.5 text-ink-subtle">{c.checkedOn ?? "-"}</td>
                  <td className="w-12 px-3 py-2.5 pr-4 text-right">
                    {canEdit && (
                      <button className="btn-subtle h-8 w-8 px-0" title="Edit" aria-label={`Edit ${c.registerId} ${c.vendor}`} onClick={() => open(c)}>
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor}
    </>
  );
}

// ---------------------------------------------------------------------------
// Cards

type CardDraft = Omit<CardRow, "id" | "updatedAt" | "updatedBy" | "statementDay"> & { statementDay: string };
const EMPTY_CARD: CardDraft = { nickname: "", last4: "", bank: "", holder: "", company: "", statementDay: "", notes: "" };

function Cards({ data, setData, canEdit }: { data: Data; setData: (d: Data) => void; canEdit: boolean }) {
  const [editing, setEditing] = useState<CardRow | "new" | null>(null);
  const [draft, setDraft] = useState<CardDraft>(EMPTY_CARD);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = (c: CardRow | "new") => {
    setEditing(c);
    setDraft(c === "new" ? EMPTY_CARD : { ...c, statementDay: c.statementDay ? String(c.statementDay) : "" });
    dialog.current?.showModal();
  };
  const save = async () => {
    const body = { ...draft, statementDay: draft.statementDay || null };
    if (editing === "new") {
      const { card } = await api<{ card: CardRow }>("/billing/cards", json("POST", body));
      setData({ ...data, cards: [...data.cards, card] });
    } else if (editing) {
      const { card } = await api<{ card: CardRow }>(`/billing/cards/${editing.id}`, json("PATCH", body));
      const charges = data.charges.map((c) => (c.card === editing.nickname ? { ...c, card: card.nickname } : c));
      setData({ ...data, charges, cards: data.cards.map((x) => (x.id === card.id ? card : x)) });
    }
  };
  const remove = async () => {
    if (!editing || editing === "new") return;
    await api(`/billing/cards/${editing.id}`, { method: "DELETE" });
    setData({ ...data, cards: data.cards.filter((x) => x.id !== editing.id) });
  };
  const set = (k: keyof CardDraft) => (v: string) => setDraft({ ...draft, [k]: v });

  return (
    <>
      <div className="mt-4 flex items-center">
        <p className="text-[13px] text-ink-subtle">Last 4 digits only. Never type a full card number, expiry or security code here.</p>
        {canEdit && (
          <button className="btn-primary ml-auto" onClick={() => open("new")}>
            <Plus className="h-4 w-4" /> Add card
          </button>
        )}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {data.cards.length === 0 && <div className="py-12 text-sm text-ink-subtle">No cards yet.</div>}
        {data.cards.map((c) => {
          const t = totals(data.charges.filter((x) => x.card === c.nickname));
          return (
            <section key={c.id} className="card p-4" aria-label={c.nickname}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink">{c.nickname}</div>
                  <div className="text-xs text-ink-subtle">{c.last4 ? `•••• ${c.last4}` : "Last 4 not set"}</div>
                </div>
                {canEdit && (
                  <button className="btn-subtle h-8 w-8 px-0" title="Edit" aria-label={`Edit ${c.nickname}`} onClick={() => open(c)}>
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]">
                <Item label="Holder" value={c.holder} />
                <Item label="Bank" value={c.bank} />
                <Item label="Company that pays" value={c.company} />
                <Item label="Statement day" value={c.statementDay ? String(c.statementDay) : ""} />
                <Item label="Services on it" value={String(t.services)} />
                <Item label="Monthly / yearly" value={`${money(t.monthly)} / ${money(t.yearly)}`} />
              </dl>
              {c.notes && <p className="mt-3 border-t border-line-subtle pt-3 text-[12.5px] text-ink-subtle">{c.notes}</p>}
            </section>
          );
        })}
      </div>

      <EditDialog
        dialogRef={dialog}
        title={editing === "new" ? "Add card" : "Edit card"}
        isNew={editing === "new"}
        stamp={editing && editing !== "new" ? editing : null}
        onSave={save}
        onRemove={remove}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <>
            <Field label="Nickname" value={draft.nickname} onChange={set("nickname")} required hint="For example: Visa 6177" />
            <Field label="Last 4 digits" value={draft.last4} onChange={set("last4")} hint="Exactly 4 digits" />
            <Field label="Card holder" value={draft.holder} onChange={set("holder")} />
            <Field label="Bank" value={draft.bank} onChange={set("bank")} />
            <Field label="Company that pays it" value={draft.company} onChange={set("company")} />
            <Field label="Statement day" value={draft.statementDay} onChange={set("statementDay")} type="number" hint="Day of the month, 1 to 31" />
            <Field label="Notes" value={draft.notes} onChange={set("notes")} area />
          </>
        )}
      </EditDialog>
    </>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-brand text-ink-subtlest">{label}</dt>
      <dd className="text-ink-subtle">{value || "-"}</dd>
    </div>
  );
}
