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
const USAGE = "usage";

export function Pill({ status }: { status: ChargeStatus }) {
  return <span className={`pill ${STATUS[status].pill}`}>{STATUS[status].label}</span>;
}

// A split-by-usage charge's share per system: the vendor's cost per workspace that month
// (all months when none is given), each workspace counted for its system. Until usage has
// been read, or for a workspace with no system, it counts as "No system yet".
export function usageShares(data: Data, vendor: string, month?: string): { code: string; part: number }[] {
  const by = new Map<string, number>();
  for (const s of moduleShares(data, vendor, month)) by.set(s.code, (by.get(s.code) ?? 0) + s.part);
  return [...by].map(([code, part]) => ({ code, part }));
}

// The same split one level down: each workspace's real cost is shared by the module
// estimates its system sends (module_usage), which can also move part of it to another
// system the sender serves (e.g. 2990s calls made through Houzs ERP). A workspace whose
// system sends no estimates for the month stays whole, with module "".
export function moduleShares(data: Data, vendor: string, month?: string): { code: string; module: string; part: number }[] {
  const systemOf = new Map(data.workspaces.filter((w) => w.vendor === vendor).map((w) => [w.workspaceId, w.systemCode || NONE]));
  const wsUsd = new Map<string, number>(); // by the workspace's system
  for (const u of data.usage) {
    if (u.vendor !== vendor || (month && u.month !== month)) continue;
    const code = systemOf.get(u.workspaceId) ?? NONE;
    wsUsd.set(code, (wsUsd.get(code) ?? 0) + u.usd);
  }
  const usd = new Map<string, number>(); // "code|module"
  const add = (code: string, module: string, v: number) => usd.set(`${code}|${module}`, (usd.get(`${code}|${module}`) ?? 0) + v);
  for (const [source, cost] of wsUsd) {
    const est = data.moduleUsage.filter((m) => m.vendor === vendor && m.sourceSystem === source && (!month || m.month === month));
    const estTotal = est.reduce((a, m) => a + m.usd, 0);
    if (source === NONE || estTotal <= 0) add(source, "", cost);
    else for (const m of est) add(m.systemCode, m.module, (cost * m.usd) / estTotal);
  }
  const total = [...usd.values()].reduce((a, v) => a + v, 0);
  if (total <= 0) return [{ code: NONE, module: "", part: 1 }];
  return [...usd].map(([k, v]) => {
    const [code, module] = k.split("|");
    return { code: code!, module: module!, part: v / total };
  });
}

// Plain names for the module (feature) names systems send; unknown ones are shown as sent.
const MODULE_NAMES: Record<string, string> = {
  scan_so: "Sales order scan",
  scan_so_distill: "Sales order scan: learning",
  cache_warm: "Sales order scan: warm-up",
  scan_payment: "Payment slip scan",
  scan_lorry_invoice: "Lorry invoice scan",
  scan_gr: "Goods received scan",
  scan_pi: "Purchase invoice scan",
  bill_extract: "Bill reading",
  credit_note_extract: "Credit note scan",
  schedule_reconcile: "Schedule reconcile",
  setup_invoice_extract: "Setup invoice reading",
  threepl_bill_read: "3PL bill reading",
  floorplan_size: "Floor plan measuring",
  announcement_translate: "Announcement translation",
  assistant: "Assistant",
  // Hookka
  scan_po: "Customer PO scan",
  scan_supplier_do: "Supplier document scan",
  scan_doc_boundary: "Supplier PDF splitting",
  scan_distill_customer: "Customer PO scan: learning",
  scan_distill_supplier: "Supplier scan: learning",
  agent_brain: "Agents",
};
export function moduleLabel(module: string) {
  if (!module) return "Whole system";
  if (module.startsWith("agent:")) return `Agent: ${module.slice(6).replace(/^\w/, (ch) => ch.toUpperCase())}`;
  return MODULE_NAMES[module] ?? module;
}

// Which systems a charge counts towards, and what part of it each one carries.
export function sharesOf(c: ChargeRow, data: Data, month?: string): { code: string; part: number }[] {
  if (c.splitByUsage) return usageShares(data, c.vendor, month);
  if (c.splits.length) return c.splits.map((s) => ({ code: s.systemCode, part: s.percent / 100 }));
  return [{ code: c.systemCode || NONE, part: 1 }];
}
export const partIn = (c: ChargeRow, code: string, data: Data, month?: string) => sharesOf(c, data, month).find((s) => s.code === code)?.part ?? 0;

export function systemLabel(data: Data, c: ChargeRow) {
  const name = (code: string) => (code === NONE ? "not known" : (data.systems.find((s) => s.code === code)?.name ?? code));
  if (c.splitByUsage) {
    const shares = usageShares(data, c.vendor);
    if (shares.length === 1 && shares[0]!.code === NONE) return "Split by usage (not read yet)";
    const shown = shares.filter((s) => Math.round(s.part * 100) > 0).sort((a, b) => b.part - a.part);
    return `Split by usage: ${shown.map((s) => `${name(s.code)} ${Math.round(s.part * 100)}%`).join(", ")}`;
  }
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
  splitByUsage: 0,
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
    if (v === USAGE) setDraft({ ...draft, systemCode: "", splits: [], splitByUsage: 1 });
    else if (v === SHARED) {
      const first = draft.systemCode || data.systems[0]!.code;
      const second = data.systems.find((s) => s.code !== first)!.code;
      setDraft({ ...draft, systemCode: "", splitByUsage: 0, splits: [{ systemCode: first, percent: "50" }, { systemCode: second, percent: "50" }] });
    } else setDraft({ ...draft, systemCode: v, splits: [], splitByUsage: 0 });
  };
  const setSplit = (i: number, patch: Partial<SplitDraft>) =>
    setDraft({ ...draft, splits: draft.splits.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const splitTotal = draft.splits.reduce((a, s) => a + (Number(s.percent) || 0), 0);
  const unused = data.systems.filter((s) => !draft.splits.some((x) => x.systemCode === s.code));
  const codeOf = draft.systemCode || draft.splits[0]?.systemCode || "";
  const modules = [...new Set(data.charges.filter((c) => codeOf && partIn(c, codeOf, data) > 0).map((c) => c.module).filter(Boolean))].sort();

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
            value={draft.splitByUsage ? USAGE : shared ? SHARED : draft.systemCode}
            onChange={pickSystem}
            options={[
              ["", "No system yet"],
              ...data.systems.map((s) => [s.code, s.name] as [string, string]),
              [SHARED, "Shared, split by %"],
              [USAGE, "Split by usage (vendor workspaces)"],
            ]}
          />
          {!!draft.splitByUsage && (
            <p className="-mt-2 text-[11px] text-ink-subtlest sm:col-span-2">
              Each month is shared by what each workspace used, read from the vendor (Anthropic) every day. Set each workspace's system on the Overview.
            </p>
          )}
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
