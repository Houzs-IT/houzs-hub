import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api, json, type CardRow, type ChargeRow, type ChargeStatus } from "../api/client";
import { useHub } from "../components/Layout";
import { fmtAgo, fmtDateTime } from "../lib/format";

const STATUS: Record<ChargeStatus, { label: string; pill: string }> = {
  confirmed: { label: "Confirmed", pill: "bg-loz-green text-loz-green-ink" },
  to_confirm: { label: "To confirm", pill: "bg-loz-orange text-loz-orange-ink" },
  to_fill_in: { label: "To fill in", pill: "bg-loz-blue text-loz-blue-ink" },
  not_active: { label: "Not active", pill: "bg-loz-grey text-loz-grey-ink" },
  cancelled: { label: "Cancelled", pill: "bg-loz-grey text-loz-grey-ink" },
};
const STATUS_ORDER = Object.keys(STATUS) as ChargeStatus[];
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "register", label: "Register" },
  { key: "cards", label: "Cards" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const NO_CARD = "No card";
// A blank card is "we don't know yet", which is not the same as "paid without a card".
const UNKNOWN_CARD = "Card not known";
const cardOf = (c: ChargeRow) => c.card || UNKNOWN_CARD;

type Data = { charges: ChargeRow[]; cards: CardRow[]; accounts: { id: number; name: string }[] };
type Totals = { services: number; confirmed: number; open: number; monthly: number; yearly: number; myrMonthly: number; myrYearly: number };

const money = (n: number, cur = "USD") =>
  `${cur === "MYR" ? "RM" : "US$"}${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

function Pill({ status }: { status: ChargeStatus }) {
  return <span className={`pill ${STATUS[status].pill}`}>{STATUS[status].label}</span>;
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
  const canEdit = !!me.perms?.includes("billing_edit");
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "overview") as Tab;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Data>("/billing")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="h-full overflow-auto px-4 py-6 md:px-8">
      <div className="eyebrow">Houzs Hub · Admin</div>
      <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">Billing</h1>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-subtle">
        What each outside service costs and which company card pays for it. Amounts are each vendor's latest bill. Cards are kept
        by their last 4 digits only.
      </p>

      <div role="tablist" className="mt-4 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setParams(t.key === "overview" ? {} : { tab: t.key }, { replace: true })}
            className={`tap -mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${
              tab === t.key ? "border-primary text-ink" : "border-transparent text-ink-subtle hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
          {error}
        </div>
      )}
      {!data && !error && <div className="py-16 text-center text-sm text-ink-subtle">Loading...</div>}

      {data && tab === "overview" && <Overview data={data} />}
      {data && tab === "register" && <Register data={data} setData={setData} canEdit={canEdit} />}
      {data && tab === "cards" && <Cards data={data} setData={setData} canEdit={canEdit} />}
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
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Monthly bills" value={money(all.monthly)} note={all.myrMonthly ? `+ ${money(all.myrMonthly, "MYR")} a month` : "a month, latest bills"} />
        <Tile label="Yearly charges" value={money(all.yearly)} note={all.myrYearly ? `+ ${money(all.myrYearly, "MYR")} a year` : "a year"} />
        <Tile label="Confirmed" value={`${all.confirmed} of ${all.services}`} note="bills opened and read" />
        <Tile label="Still to confirm" value={String(all.open)} note="need a login or a bill to read" />
      </div>

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

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card p-4">
      <span className="section-title">{label}</span>
      <div className="mt-2 text-[24px] font-extrabold tabular-nums text-ink">{value}</div>
      <div className="text-xs text-ink-subtle">{note}</div>
    </div>
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

type ChargeDraft = Omit<ChargeRow, "id" | "updatedAt" | "updatedBy" | "amount" | "accountId"> & { amount: string; accountId: string };
const EMPTY_CHARGE: ChargeDraft = {
  registerId: "",
  accountId: "",
  company: "",
  system: "",
  vendor: "",
  serviceType: "",
  usedFor: "",
  plan: "",
  amount: "",
  currency: "USD",
  billed: "monthly",
  card: "",
  status: "to_confirm",
  checkedOn: null,
  keyName: "",
  notes: "",
};

function Register({ data, setData, canEdit }: { data: Data; setData: (d: Data) => void; canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<ChargeStatus | "">("");
  const [card, setCard] = useState("");
  const [editing, setEditing] = useState<ChargeRow | "new" | null>(null);
  const [draft, setDraft] = useState<ChargeDraft>(EMPTY_CHARGE);
  const dialog = useRef<HTMLDialogElement>(null);
  const companies = useMemo(() => [...new Set(data.charges.map((c) => c.company).filter(Boolean))].sort(), [data.charges]);
  const cardNames = useMemo(
    () => [...new Set([...data.cards.map((c) => c.nickname), ...data.charges.map((c) => c.card).filter(Boolean)])].sort(),
    [data],
  );

  const open = (c: ChargeRow | "new") => {
    setEditing(c);
    setDraft(c === "new" ? EMPTY_CHARGE : { ...c, amount: c.amount === null ? "" : String(c.amount), accountId: c.accountId ? String(c.accountId) : "" });
    dialog.current?.showModal();
  };

  const needle = q.trim().toLowerCase();
  const shown = data.charges.filter(
    (c) =>
      (!company || c.company === company) &&
      (!status || c.status === status) &&
      (!card || cardOf(c) === card) &&
      (!needle ||
        [c.registerId, c.company, c.system, c.vendor, c.serviceType, c.usedFor, c.plan, c.card, c.keyName, c.notes].join(" ").toLowerCase().includes(needle)),
  );
  const t = totals(shown);

  const save = async () => {
    const body = { ...draft, amount: draft.amount === "" ? null : Number(draft.amount), accountId: draft.accountId || null };
    if (editing === "new") {
      const { charge } = await api<{ charge: ChargeRow }>("/billing/charges", json("POST", body));
      setData({ ...data, charges: [...data.charges, charge] });
    } else if (editing) {
      const { charge } = await api<{ charge: ChargeRow }>(`/billing/charges/${editing.id}`, json("PATCH", body));
      setData({ ...data, charges: data.charges.map((x) => (x.id === charge.id ? charge : x)) });
    }
  };
  const remove = async () => {
    if (!editing || editing === "new") return;
    await api(`/billing/charges/${editing.id}`, { method: "DELETE" });
    setData({ ...data, charges: data.charges.filter((x) => x.id !== editing.id) });
  };

  const set = (k: keyof ChargeDraft) => (v: string) => setDraft({ ...draft, [k]: v });

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
                <div className="text-xs text-ink-subtle">{[c.company, c.system, c.serviceType].filter(Boolean).join(" · ")}</div>
              </div>
              <Pill status={c.status} />
            </div>
            {c.usedFor && <div className="mt-2 text-[12.5px] text-ink-subtle">{c.usedFor}</div>}
            <div className="mt-2 text-[13px] text-ink">
              {c.amount === null ? "Amount not known" : money(c.amount, c.currency)}
              {c.billed && <span className="text-ink-subtle"> · {c.billed}</span>}
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
                    <div className="text-xs text-ink-subtle">{[c.company, c.system, c.serviceType].filter(Boolean).join(" · ")}</div>
                    {c.usedFor && <div className="max-w-md text-xs text-ink-subtlest">{c.usedFor}</div>}
                  </td>
                  <td className="w-44 px-3 py-2.5 text-ink-subtle">{c.plan || "-"}</td>
                  <td className="w-28 px-3 py-2.5 tabular-nums text-ink">{c.amount === null ? "-" : money(c.amount, c.currency)}</td>
                  <td className="w-20 px-3 py-2.5 capitalize text-ink-subtle">{c.billed || "-"}</td>
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

      <EditDialog
        dialogRef={dialog}
        title={editing === "new" ? "Add charge" : "Edit charge"}
        isNew={editing === "new"}
        stamp={editing && editing !== "new" ? editing : null}
        onSave={save}
        onRemove={remove}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <>
            <Field label="Vendor" value={draft.vendor} onChange={set("vendor")} required hint="For example: Supabase" />
            <Field label="Sheet ID" value={draft.registerId} onChange={set("registerId")} hint="C01, H03... as in the card sheet" />
            <Field label="Company" value={draft.company} onChange={set("company")} hint="Conts, Houzs, Hookka or Shared" />
            <Field label="System" value={draft.system} onChange={set("system")} />
            <Field label="Service type" value={draft.serviceType} onChange={set("serviceType")} hint="Hosting, Database, Email, AI..." />
            <Field label="Plan" value={draft.plan} onChange={set("plan")} />
            <Field label="Latest bill" value={draft.amount} onChange={set("amount")} type="number" hint="Leave empty if not known" />
            <Select label="Currency" value={draft.currency} onChange={set("currency")} options={[["USD", "USD"], ["MYR", "MYR"]]} />
            <Select label="Billed" value={draft.billed} onChange={set("billed")} options={[["monthly", "Monthly"], ["yearly", "Yearly"], ["", "Not billed / not known"]]} />
            <Select
              label="Card"
              value={draft.card}
              onChange={set("card")}
              options={[["", "Not known"], ...data.cards.map((c) => [c.nickname, c.nickname] as [string, string]), [NO_CARD, NO_CARD]]}
            />
            <Select label="Status" value={draft.status} onChange={set("status")} options={STATUS_ORDER.map((s) => [s, STATUS[s].label] as [string, string])} />
            <Field label="Last checked" value={draft.checkedOn ?? ""} onChange={(v) => setDraft({ ...draft, checkedOn: v || null })} type="date" />
            <Select
              label="Account"
              value={draft.accountId}
              onChange={set("accountId")}
              options={[["", "Not linked"], ...data.accounts.map((a) => [String(a.id), a.name] as [string, string])]}
            />
            <Field label="Key / setting name" value={draft.keyName} onChange={set("keyName")} hint="The name only, never the key itself" />
            <Field label="What it is used for" value={draft.usedFor} onChange={set("usedFor")} area />
            <Field label="Notes" value={draft.notes} onChange={set("notes")} area />
          </>
        )}
      </EditDialog>
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

// ---------------------------------------------------------------------------
// Shared form bits

function Field(props: { label: string; value: string; onChange: (v: string) => void; required?: boolean; hint?: string; area?: boolean; type?: string }) {
  return (
    <label className={`block text-[12px] font-semibold text-ink-subtle ${props.area ? "sm:col-span-2" : ""}`}>
      {props.label}
      {props.area ? (
        <textarea className="input mt-1 h-auto min-h-[64px] w-full py-2" rows={2} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input
          className="input mt-1 w-full"
          type={props.type ?? "text"}
          step={props.type === "number" ? "any" : undefined}
          required={props.required}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
      {props.hint && <span className="mt-1 block text-[11px] font-normal text-ink-subtlest">{props.hint}</span>}
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block text-[12px] font-semibold text-ink-subtle">
      {label}
      <select className="input mt-1 w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function EditDialog(props: {
  dialogRef: React.RefObject<HTMLDialogElement>;
  title: string;
  isNew: boolean;
  stamp: { updatedAt: string; updatedBy: string | null } | null;
  onSave: () => Promise<void>;
  onRemove: () => Promise<void>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      props.dialogRef.current?.close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(props.onSave);
  };

  return (
    <dialog
      ref={props.dialogRef}
      onClose={() => {
        setErr(null);
        setConfirming(false);
        props.onClose();
      }}
      className="card w-[720px] max-w-[calc(100vw-32px)] p-0 text-ink backdrop:bg-black/40"
    >
      <form onSubmit={submit}>
        <div className="border-b border-line px-5 py-3 text-[15px] font-bold">{props.title}</div>
        <div className="grid max-h-[65vh] gap-4 overflow-y-auto px-5 py-4 sm:grid-cols-2">{props.children}</div>
        {err && (
          <div role="alert" className="mx-5 mb-3 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
            {err}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          {!props.isNew &&
            (confirming ? (
              <>
                <span className="text-sm text-loz-red-ink">Remove for good?</span>
                <button type="button" className="btn border border-loz-red-ink bg-loz-red-ink text-surface hover:opacity-90" disabled={busy} onClick={() => run(props.onRemove)}>
                  Remove
                </button>
                <button type="button" className="btn-subtle" onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button type="button" className="btn-subtle text-loz-red-ink" onClick={() => setConfirming(true)}>
                <Trash2 className="h-4 w-4" /> Remove
              </button>
            ))}
          {props.stamp && (
            <span className="text-[11px] text-ink-subtlest" title={fmtDateTime(props.stamp.updatedAt)}>
              Updated {fmtAgo(props.stamp.updatedAt)}
              {props.stamp.updatedBy ? ` by ${props.stamp.updatedBy}` : ""}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-default" onClick={() => props.dialogRef.current?.close()}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy}>
              {props.isNew ? "Add" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
