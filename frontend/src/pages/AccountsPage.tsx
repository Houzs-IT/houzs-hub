import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, json, type AccountRow, type AccountStatus } from "../api/client";
import { useHub } from "../components/Layout";
import { fmtAgo, fmtDateTime } from "../lib/format";

const STATUS: Record<AccountStatus, { label: string; pill: string }> = {
  yes: { label: "Moved", pill: "bg-loz-green text-loz-green-ink" },
  partly: { label: "Partly", pill: "bg-loz-orange text-loz-orange-ink" },
  not_yet: { label: "Not yet", pill: "bg-loz-red text-loz-red-ink" },
  cant_move: { label: "Can't move", pill: "bg-loz-grey text-loz-grey-ink" },
};
const STATUS_ORDER: AccountStatus[] = ["yes", "partly", "not_yet", "cant_move"];
const GOAL = "it@houzscentury.com";
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

type Draft = Omit<AccountRow, "id" | "createdAt" | "updatedAt" | "updatedBy">;
const EMPTY: Draft = {
  name: "",
  companies: "",
  vendor: "",
  mainOwner: "",
  control: "",
  itAccess: "",
  status: "not_yet",
  billsTo: "",
  registerIds: "",
  nextStep: "",
};

const emailsIn = (s: string) => new Set((s.match(EMAIL) ?? []).map((e) => e.toLowerCase()));
const ownerUnknown = (a: AccountRow) => !a.mainOwner || /not known/i.test(a.mainOwner);
const companiesOf = (a: AccountRow) => a.companies.split(",").map((c) => c.trim()).filter(Boolean);

function StatusPill({ status }: { status: AccountStatus }) {
  return <span className={`pill ${STATUS[status].pill}`}>{STATUS[status].label}</span>;
}

// How many accounts each email appears in, from the free-text owner and control
// fields, so nobody has to keep a separate tally.
function emailCounts(rows: AccountRow[]) {
  const map = new Map<string, { control: number; owner: number }>();
  for (const a of rows) {
    const owner = emailsIn(a.mainOwner);
    for (const e of new Set([...emailsIn(a.control), ...owner])) {
      const m = map.get(e) ?? { control: 0, owner: 0 };
      m.control += 1;
      if (owner.has(e)) m.owner += 1;
      map.set(e, m);
    }
  }
  return [...map.entries()].sort((x, y) => (x[0] === GOAL ? -1 : y[0] === GOAL ? 1 : y[1].control - x[1].control || x[0].localeCompare(y[0])));
}

export default function AccountsPage() {
  const { me } = useHub();
  const canEdit = !!me.perms?.includes("accounts_edit");
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<AccountStatus | "">("");
  const [editing, setEditing] = useState<AccountRow | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const load = useCallback(() => {
    api<{ accounts: AccountRow[] }>("/accounts")
      .then((d) => {
        setRows(d.accounts);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const open = (a: AccountRow | "new") => {
    setEditing(a);
    setDraft(a === "new" ? EMPTY : { ...a });
    setFormError(null);
    setConfirmDelete(false);
    dialog.current?.showModal();
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      if (editing === "new") {
        const { account } = await api<{ account: AccountRow }>("/accounts", json("POST", draft));
        setRows((r) => [...(r ?? []), account]);
      } else if (editing) {
        const { account } = await api<{ account: AccountRow }>(`/accounts/${editing.id}`, json("PATCH", draft));
        setRows((r) => r?.map((x) => (x.id === account.id ? account : x)) ?? null);
      }
      dialog.current?.close();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing || editing === "new") return;
    setBusy(true);
    try {
      await api(`/accounts/${editing.id}`, { method: "DELETE" });
      setRows((r) => r?.filter((x) => x.id !== editing.id) ?? null);
      dialog.current?.close();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const all = rows ?? [];
  const companies = useMemo(() => [...new Set(all.flatMap(companiesOf))].sort(), [all]);
  const counts = useMemo(() => emailCounts(all), [all]);
  const unknown = all.filter(ownerUnknown).length;
  const needle = q.trim().toLowerCase();
  const shown = all.filter(
    (a) =>
      (!company || companiesOf(a).includes(company)) &&
      (!status || a.status === status) &&
      (!needle ||
        [a.name, a.vendor, a.companies, a.mainOwner, a.control, a.itAccess, a.billsTo, a.registerIds, a.nextStep]
          .join(" ")
          .toLowerCase()
          .includes(needle)),
  );

  const field = (key: keyof Draft, label: string, opts: { area?: boolean; hint?: string; required?: boolean } = {}) => (
    <label className={`block text-[12px] font-semibold text-ink-subtle ${opts.area ? "sm:col-span-2" : ""}`}>
      {label}
      {opts.area ? (
        <textarea
          className="input mt-1 h-auto min-h-[64px] w-full py-2"
          rows={2}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
      ) : (
        <input
          className="input mt-1 w-full"
          required={opts.required}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
      )}
      {opts.hint && <span className="mt-1 block text-[11px] font-normal text-ink-subtlest">{opts.hint}</span>}
    </label>
  );

  return (
    <div className="h-full overflow-auto px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Houzs Hub · Finance</div>
          <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">Accounts</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-subtle">
            Every outside account the companies rely on and who controls it. The goal is for all of them to be under {GOAL}. Never
            put passwords, API keys or card numbers here.
          </p>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => open("new")}>
            <Plus className="h-4 w-4" /> Add account
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
          {error}
        </div>
      )}
      {!rows && !error && <div className="py-16 text-center text-sm text-ink-subtle">Loading...</div>}

      {rows && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(status === s ? "" : s)}
                aria-pressed={status === s}
                className={`card p-4 text-left transition-colors hover:border-line-strong ${status === s ? "border-primary ring-2 ring-primary/20" : ""}`}
              >
                <StatusPill status={s} />
                <div className="mt-2 text-[26px] font-extrabold tabular-nums text-ink">{all.filter((a) => a.status === s).length}</div>
                <div className="text-xs text-ink-subtle">accounts</div>
              </button>
            ))}
            <div className="card p-4">
              <span className="section-title">Total</span>
              <div className="mt-2 text-[26px] font-extrabold tabular-nums text-ink">{all.length}</div>
              <div className="text-xs text-ink-subtle">accounts tracked</div>
            </div>
          </div>

          <section className="card mt-4 overflow-x-auto" aria-label="Accounts per email">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {["Email", "Has control of", "Main owner of"].map((h, i) => (
                    <th
                      key={h}
                      className={`border-b-2 border-line bg-surface-dim px-3 py-2.5 text-[10px] font-bold uppercase tracking-brand text-ink-subtle first:pl-4 last:pr-4 ${i ? "text-right" : "text-left"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {counts.map(([email, n]) => (
                  <tr key={email} className="border-b border-line-subtle last:border-0">
                    <td className="break-words px-3 py-2 pl-4 text-ink">
                      {email} {email === GOAL && <span className="pill ml-1 bg-loz-green text-loz-green-ink">Goal</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{n.control}</td>
                    <td className="px-3 py-2 pr-4 text-right tabular-nums">{n.owner}</td>
                  </tr>
                ))}
                <tr>
                  <td className="px-3 py-2 pl-4 text-ink-subtle">Owner not known yet</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-subtle">-</td>
                  <td className="px-3 py-2 pr-4 text-right tabular-nums">{unknown}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-subtlest" />
              <input className="input w-full pl-8" placeholder="Search accounts" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="input" value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company">
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as AccountStatus | "")} aria-label="Moved to it@">
              <option value="">Any status</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS[s].label}
                </option>
              ))}
            </select>
            <span className="text-xs text-ink-subtle">
              {shown.length} of {all.length}
            </span>
          </div>

          {shown.length === 0 && <div className="py-12 text-center text-sm text-ink-subtle">No accounts match.</div>}

          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:hidden">
            {shown.map((a) => (
              <div key={a.id} className="card p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-ink">{a.name}</div>
                    <div className="text-xs text-ink-subtle">
                      {[a.vendor, a.companies].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <StatusPill status={a.status} />
                </div>
                <dl className="mt-3 grid gap-1.5 text-[12.5px]">
                  <Row label="Main owner" value={a.mainOwner} />
                  <Row label="Who has control" value={a.control} />
                  <Row label="it@ access" value={a.itAccess} />
                  <Row label="Bills go to" value={a.billsTo} />
                  <Row label="Next step" value={a.nextStep} />
                </dl>
                {canEdit && (
                  <button className="btn-default mt-3 h-8 px-3" onClick={() => open(a)}>
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
                    {["Account", "Main owner", "Who has control", "it@ access", "Status", "Bills go to", "Next step", ""].map((h, i) => (
                      <th
                        key={i}
                        className="border-b-2 border-line bg-surface-dim px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-brand text-ink-subtle first:rounded-tl-[10px] first:pl-4 last:rounded-tr-[10px]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.id} className="border-b border-line-subtle align-top last:border-0">
                      <td className="w-64 px-3 py-2.5 pl-4">
                        <div className="font-medium text-ink">{a.name}</div>
                        <div className="text-xs text-ink-subtle">{[a.vendor, a.companies].filter(Boolean).join(" · ")}</div>
                        {a.registerIds && <div className="text-[11px] text-ink-subtlest">Sheet rows {a.registerIds}</div>}
                      </td>
                      <td className="w-48 break-words px-3 py-2.5 text-ink-subtle">{a.mainOwner || "-"}</td>
                      <td className="break-words px-3 py-2.5 text-ink-subtle">{a.control || "-"}</td>
                      <td className="w-32 px-3 py-2.5 text-ink-subtle">{a.itAccess || "-"}</td>
                      <td className="w-28 px-3 py-2.5">
                        <StatusPill status={a.status} />
                      </td>
                      <td className="w-40 break-words px-3 py-2.5 text-ink-subtle">{a.billsTo || "-"}</td>
                      <td className="break-words px-3 py-2.5 text-ink-subtle">{a.nextStep || "-"}</td>
                      <td className="w-12 px-3 py-2.5 pr-4 text-right">
                        {canEdit && (
                          <button className="btn-subtle h-8 w-8 px-0" title="Edit" aria-label={`Edit ${a.name}`} onClick={() => open(a)}>
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
        </>
      )}

      <dialog
        ref={dialog}
        onClose={() => setEditing(null)}
        className="card w-[720px] max-w-[calc(100vw-32px)] p-0 text-ink backdrop:bg-black/40"
      >
        {editing && (
          <form onSubmit={save}>
            <div className="border-b border-line px-5 py-3 text-[15px] font-bold">{editing === "new" ? "Add account" : "Edit account"}</div>
            <div className="grid max-h-[65vh] gap-4 overflow-y-auto px-5 py-4 sm:grid-cols-2">
              {field("name", "Account", { required: true, hint: "For example: Cloudflare 'Conts ERP'" })}
              {field("vendor", "Vendor")}
              {field("companies", "Company", { hint: "Conts, Houzs, Hookka or Shared; several with commas" })}
              <label className="block text-[12px] font-semibold text-ink-subtle">
                Moved to it@?
                <select
                  className="input mt-1 w-full"
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as AccountStatus })}
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {STATUS[s].label}
                    </option>
                  ))}
                </select>
              </label>
              {field("mainOwner", "Main owner", { hint: "The email or login that owns it. Write 'Not known yet' if unsure" })}
              {field("itAccess", "it@ access", { hint: "Owner, Admin, Super admin, None..." })}
              {field("control", "Who has control", { area: true, hint: "Every email or login that can manage it, with its role" })}
              {field("billsTo", "Bills go to")}
              {field("registerIds", "Sheet rows", { hint: "Register IDs in the card sheet, e.g. H03, S04" })}
              {field("nextStep", "Next step", { area: true })}
            </div>
            {formError && (
              <div role="alert" className="mx-5 mb-3 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
                {formError}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
              {editing !== "new" &&
                (confirmDelete ? (
                  <>
                    <span className="text-sm text-loz-red-ink">Remove this account for good?</span>
                    <button type="button" className="btn border border-loz-red-ink bg-loz-red-ink text-surface hover:opacity-90" disabled={busy} onClick={remove}>
                      Remove
                    </button>
                    <button type="button" className="btn-subtle" onClick={() => setConfirmDelete(false)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-subtle text-loz-red-ink" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-4 w-4" /> Remove
                  </button>
                ))}
              {editing !== "new" && (
                <span className="text-[11px] text-ink-subtlest" title={fmtDateTime(editing.updatedAt)}>
                  Updated {fmtAgo(editing.updatedAt)}
                  {editing.updatedBy ? ` by ${editing.updatedBy}` : ""}
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <button type="button" className="btn-default" onClick={() => dialog.current?.close()}>
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy}>
                  {editing === "new" ? "Add" : "Save"}
                </button>
              </div>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-brand text-ink-subtlest">{label}</dt>
      <dd className="break-words text-ink-subtle">{value}</dd>
    </div>
  );
}
