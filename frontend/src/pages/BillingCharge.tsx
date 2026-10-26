import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { api, json, type BillingData as Data, type ChargeRow, type ChargeStatus } from "../api/client";
import { EditDialog, Field, Select } from "../components/EditForm";

// Pieces of System billing shared by the Register and the system tabs: the charge
// editor, status pills, billing types, and which system(s) a charge belongs to.

export const STATUS: Record<ChargeStatus, { label: string; pill: string }> = {
  confirmed: { label: "Confirmed", pill: "bg-loz-green text-loz-green-ink" },
  to_confirm: { label: "To confirm", pill: "bg-loz-orange text-loz-orange-ink" },
  to_fill_in: { label: "To fill in", pill: "bg-loz-blue text-loz-blue-ink" },
  not_active: { label: "Not active", pill: "bg-loz-grey text-loz-grey-ink" },
  cancelled: { label: "Cancelled", pill: "bg-loz-grey text-loz-grey-ink" },
};
export const STATUS_ORDER = Object.keys(STATUS) as ChargeStatus[];
export const BILLED: Record<ChargeRow["billed"], string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  credit: "Per credit",
  usage: "Per use",
  "": "Not billed / not known",
};
export const NO_CARD = "No card";
// No system and no split yet: shown under "No system yet" until a person sets one.
export const NONE = "none";
const SHARED = "shared";

export function Pill({ status }: { status: ChargeStatus }) {
  return <span className={`pill ${STATUS[status].pill}`}>{STATUS[status].label}</span>;
}

// Which systems a charge counts towards, and what part of it each one carries.
export function sharesOf(c: ChargeRow): { code: string; part: number }[] {
  if (c.splits.length) return c.splits.map((s) => ({ code: s.systemCode, part: s.percent / 100 }));
  return [{ code: c.systemCode || NONE, part: 1 }];
}
export const partIn = (c: ChargeRow, code: string) => sharesOf(c).find((s) => s.code === code)?.part ?? 0;

export function systemLabel(data: Data, c: ChargeRow) {
  const name = (code: string) => data.systems.find((s) => s.code === code)?.name ?? code;
  if (c.splits.length) return `Shared: ${c.splits.map((s) => `${name(s.systemCode)} ${s.percent}%`).join(", ")}`;
  return c.systemCode ? name(c.systemCode) : "No system yet";
}

type SplitDraft = { systemCode: string; percent: string };
type ChargeDraft = Omit<ChargeRow, "id" | "updatedAt" | "updatedBy" | "amount" | "accountId" | "splits"> & {
  amount: string;
  accountId: string;
  splits: SplitDraft[];
};
const EMPTY_CHARGE: ChargeDraft = {
  registerId: "",
  accountId: "",
  company: "",
  system: "",
  systemCode: "",
  projectRef: "",
  module: "",
  splits: [],
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

// The Add / Edit charge pop-up. Returns open() and the dialog to render once on the page.
export function useChargeEditor(data: Data, setData: (d: Data) => void) {
  const [editing, setEditing] = useState<ChargeRow | "new" | null>(null);
  const [draft, setDraft] = useState<ChargeDraft>(EMPTY_CHARGE);
  const dialog = useRef<HTMLDialogElement>(null);

  const open = (c: ChargeRow | "new", preset: Partial<ChargeDraft> = {}) => {
    setEditing(c);
    setDraft(
      c === "new"
        ? { ...EMPTY_CHARGE, ...preset }
        : {
            ...c,
            amount: c.amount === null ? "" : String(c.amount),
            accountId: c.accountId ? String(c.accountId) : "",
            splits: c.splits.map((s) => ({ systemCode: s.systemCode, percent: String(s.percent) })),
          },
    );
    dialog.current?.showModal();
  };

  const save = async () => {
    const body = {
      ...draft,
      amount: draft.amount === "" ? null : Number(draft.amount),
      accountId: draft.accountId || null,
      splits: draft.splits.map((s) => ({ systemCode: s.systemCode, percent: Number(s.percent) })),
    };
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
  const shared = draft.splits.length > 0;
  const pickSystem = (v: string) => {
    if (v === SHARED) {
      const first = draft.systemCode || data.systems[0]!.code;
      const second = data.systems.find((s) => s.code !== first)!.code;
      setDraft({ ...draft, systemCode: "", splits: [{ systemCode: first, percent: "50" }, { systemCode: second, percent: "50" }] });
    } else setDraft({ ...draft, systemCode: v, splits: [] });
  };
  const setSplit = (i: number, patch: Partial<SplitDraft>) =>
    setDraft({ ...draft, splits: draft.splits.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const splitTotal = draft.splits.reduce((a, s) => a + (Number(s.percent) || 0), 0);
  const unused = data.systems.filter((s) => !draft.splits.some((x) => x.systemCode === s.code));
  const codeOf = draft.systemCode || draft.splits[0]?.systemCode || "";
  const modules = [...new Set(data.charges.filter((c) => codeOf && partIn(c, codeOf) > 0).map((c) => c.module).filter(Boolean))].sort();

  const editor = (
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
          <Field label="Sheet ID" value={draft.registerId} onChange={set("registerId")} hint="C01, H03... Statement lines are matched by it" />
          <Select
            label="System"
            value={shared ? SHARED : draft.systemCode}
            onChange={pickSystem}
            options={[["", "No system yet"], ...data.systems.map((s) => [s.code, s.name] as [string, string]), [SHARED, "Shared, split by %"]]}
          />
          <Field label="Company" value={draft.company} onChange={set("company")} hint="Conts, Houzs, Hookka or Shared" />
          {draft.system && <p className="-mt-2 text-[11px] text-ink-subtlest sm:col-span-2">The card sheet said: {draft.system}</p>}
          {shared && (
            <fieldset className="rounded border border-line p-3 sm:col-span-2">
              <legend className="px-1 text-[12px] font-semibold text-ink-subtle">Share per system</legend>
              {draft.splits.map((s, i) => (
                <div key={i} className="mt-1.5 flex items-center gap-2">
                  <select
                    className="input flex-1"
                    aria-label={`System ${i + 1}`}
                    value={s.systemCode}
                    onChange={(e) => setSplit(i, { systemCode: e.target.value })}
                  >
                    {data.systems
                      .filter((x) => x.code === s.systemCode || !draft.splits.some((y) => y.systemCode === x.code))
                      .map((x) => (
                        <option key={x.code} value={x.code}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                  <input
                    className="input w-20 text-right"
                    type="number"
                    step="any"
                    aria-label={`Share for system ${i + 1}, percent`}
                    value={s.percent}
                    onChange={(e) => setSplit(i, { percent: e.target.value })}
                  />
                  <span className="text-[12px] text-ink-subtle">%</span>
                  <button
                    type="button"
                    className="btn-subtle h-8 w-8 px-0"
                    aria-label={`Remove system ${i + 1}`}
                    disabled={draft.splits.length <= 2}
                    onClick={() => setDraft({ ...draft, splits: draft.splits.filter((_, k) => k !== i) })}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="mt-2 flex items-center gap-3">
                {unused.length > 0 && (
                  <button
                    type="button"
                    className="btn-default h-8 px-3"
                    onClick={() => setDraft({ ...draft, splits: [...draft.splits, { systemCode: unused[0]!.code, percent: "" }] })}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add system
                  </button>
                )}
                <span className={`text-[12px] tabular-nums ${Math.abs(splitTotal - 100) < 0.001 ? "text-ink-subtle" : "text-loz-red-ink"}`}>
                  Total {Math.round(splitTotal * 100) / 100}% (must be 100%)
                </span>
              </div>
            </fieldset>
          )}
          <label className="block text-[12px] font-semibold text-ink-subtle">
            Module
            <input className="input mt-1 w-full" list="billing-modules" value={draft.module} onChange={(e) => set("module")(e.target.value)} />
            <datalist id="billing-modules">
              {modules.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <span className="mt-1 block text-[11px] font-normal text-ink-subtlest">Leave empty when the bill is for the whole system</span>
          </label>
          <Field label="Project / API ID" value={draft.projectRef} onChange={set("projectRef")} hint="Project ref, account or key name. Never a secret" />
          <Field label="Service type" value={draft.serviceType} onChange={set("serviceType")} hint="Hosting, Database, Email, AI..." />
          <Field label="Plan" value={draft.plan} onChange={set("plan")} />
          <Field label="Latest bill" value={draft.amount} onChange={set("amount")} type="number" hint="Leave empty if not known" />
          <Select label="Currency" value={draft.currency} onChange={set("currency")} options={[["USD", "USD"], ["MYR", "MYR"]]} />
          <Select
            label="Billed"
            value={draft.billed}
            onChange={set("billed")}
            options={(["monthly", "yearly", "credit", "usage", ""] as const).map((b) => [b, BILLED[b]] as [string, string])}
          />
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
  );

  return { open, editor };
}
