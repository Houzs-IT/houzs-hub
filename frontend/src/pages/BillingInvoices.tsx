import { FileText, FileUp, Pencil } from "lucide-react";
import { useRef, useState } from "react";
import { api, invoiceFileUrl, json, type BillingData as Data, type ChargeRow, type InvoiceRow, type ProjectRef, type StatementLine } from "../api/client";
import { EditDialog, Field, Select } from "../components/EditForm";
import { readInvoiceText, type ReadInvoice, type ReadLine } from "../lib/invoiceRead";
import { pdfText } from "../lib/pdfText";
import { money } from "../lib/format";
import { systemLabel } from "./BillingCharge";
import { monthName, monthOf, rm, TH } from "./BillingStatements";

// The Invoices tab of System billing. Invoice PDFs are read in the browser
// (lib/invoiceRead.ts); for each one the page suggests the charge it is for and the card
// statement line that paid it, the person checks, and the hub stores the PDF and links.

// Long lists scroll inside their box, about ten rows high, with the headings kept in view.
const SCROLL = "max-h-[min(60vh,520px)] overflow-auto";
const STICKY = "sticky top-0 z-10";

const vendorWord =(v: string) => v.toLowerCase().match(/[a-z0-9]{4,}/)?.[0] ?? "";
// "USD 12.29" kept on a statement line as its foreign amount.
const foreignOf = (notes: string) => {
  const m = notes.match(/([A-Z]{3})\s?([\d,]+\.\d{2})/);
  return m ? { currency: m[1]!, amount: Number(m[2]!.replace(/,/g, "")) } : null;
};
const days = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 864e5;

type Form = {
  vendor: string;
  invoiceNo: string;
  invoiceDate: string;
  periodFrom: string | null;
  periodTo: string | null;
  billTo: string;
  total: string;
  currency: "USD" | "MYR";
  chargeId: string;
  statementLineId: string;
  notes: string;
};
type Draft = { key: string; file: File; state: "reading" | "ready" | "saving" | "saved"; error: string; warnings: string[]; form: Form; lines: ReadLine[] };

// The statement lines an invoice could have been paid by: the vendor's name on the line,
// within 45 days, not already paying another invoice. Closest first.
function candidateLines(data: Data, f: Pick<Form, "vendor" | "invoiceDate">, keep: string) {
  const word = vendorWord(f.vendor);
  const taken = new Set(data.invoices.map((i) => i.statementLineId).filter((x) => x !== null));
  return data.lines
    .filter((l) => String(l.id) === keep || (!taken.has(l.id) && word && l.description.toLowerCase().includes(word) && (!f.invoiceDate || days(l.txnDate, f.invoiceDate) <= 45)))
    .sort((a, b) => (f.invoiceDate ? days(a.txnDate, f.invoiceDate) - days(b.txnDate, f.invoiceDate) : 0));
}

// Paid by: the same amount in the invoice's currency within 7 days (the statement keeps
// the foreign amount, e.g. "USD 12.29"); ringgit invoices compare the ringgit amount.
function suggestLine(data: Data, r: ReadInvoice): StatementLine | undefined {
  if (r.total === null) return undefined;
  return candidateLines(data, r, "").find((l) => {
    if (days(l.txnDate, r.invoiceDate) > 7) return false;
    if (r.currency === "MYR") return Math.abs(l.amountMyr - r.total!) < 0.005;
    const f = foreignOf(l.notes);
    return !!f && f.currency === r.currency && Math.abs(f.amount - r.total!) < 0.005;
  });
}

// The charge: from a known project ID, else the last invoice billed to the same account,
// else the charge the paying statement line is already matched to, else the only live
// charge with that vendor name.
function suggestCharge(data: Data, r: ReadInvoice, line: StatementLine | undefined): ChargeRow | undefined {
  const byId = (id: number | null) => data.charges.find((c) => c.id === id);
  for (const l of r.lines) {
    const ref = data.projectRefs.find((p) => p.ref === l.projectRef && p.chargeId !== null);
    if (ref) return byId(ref.chargeId);
  }
  const last = data.invoices.find((i) => i.vendor.toLowerCase() === r.vendor.toLowerCase() && i.billTo === r.billTo && i.chargeId !== null);
  if (last) return byId(last.chargeId);
  if (line?.registerId) {
    const c = data.charges.find((x) => x.registerId === line.registerId);
    if (c) return c;
  }
  const same = data.charges.filter((c) => c.status !== "cancelled" && c.vendor.toLowerCase() === r.vendor.toLowerCase());
  return same.length === 1 ? same[0] : undefined;
}

const lineLabel = (l: StatementLine) => `${l.txnDate} · ${l.card || "card not known"} · ${rm(l.amountMyr)}${l.notes ? ` · ${l.notes}` : ""}`;
const chargeLabel = (data: Data, c: ChargeRow) => `${c.registerId || "-"} ${c.vendor} · ${systemLabel(data, c)}`;
const chargeOptions = (data: Data, vendor: string): [string, string][] => {
  const v = vendor.toLowerCase();
  const sorted = [...data.charges].sort((a, b) => Number(b.vendor.toLowerCase() === v) - Number(a.vendor.toLowerCase() === v));
  return [["", "Pick the charge"], ...sorted.map((c) => [String(c.id), chargeLabel(data, c)] as [string, string])];
};

function body(form: Form, lines: { description: string; projectRef: string; amount: number; kind: string }[]) {
  return { ...form, total: Number(form.total), chargeId: form.chargeId || null, statementLineId: form.statementLineId || null, lines };
}

export function Invoices({ data, setData, canEdit }: { data: Data; setData: (d: Data) => void; canEdit: boolean }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const review = useRef<HTMLDialogElement>(null);
  const [show, setShow] = useState<"all" | "unpaid" | "nocharge">("all");
  const [month, setMonth] = useState("");
  const [vendor, setVendor] = useState("");
  const [refCharge, setRefCharge] = useState("");
  const [refUse, setRefUse] = useState("");
  const [refQ, setRefQ] = useState("");
  const [editing, setEditing] = useState<InvoiceRow | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const editDialog = useRef<HTMLDialogElement>(null);
  const [refEditing, setRefEditing] = useState<ProjectRef | null>(null);
  const [refForm, setRefForm] = useState({ name: "", chargeId: "", inUse: "1" });
  const refDialog = useRef<HTMLDialogElement>(null);

  const reload = async () => setData(await api<Data>("/billing"));
  const patchDraft = (key: string, p: Partial<Draft> | ((d: Draft) => Partial<Draft>)) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...(typeof p === "function" ? p(d) : p) } : d)));
  const setDraftForm = (key: string, p: Partial<Form>) => patchDraft(key, (d) => ({ form: { ...d.form, ...p } }));

  const pick = (files: FileList | null) => {
    const list = [...(files ?? [])].filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (!list.length) return;
    const fresh: Draft[] = list.map((file) => ({
      key: `${file.name}-${file.size}-${Math.random()}`,
      file,
      state: "reading",
      error: "",
      warnings: [],
      form: { vendor: "", invoiceNo: "", invoiceDate: "", periodFrom: null, periodTo: null, billTo: "", total: "", currency: "USD", chargeId: "", statementLineId: "", notes: "" },
      lines: [],
    }));
    setDrafts((ds) => [...ds.filter((d) => d.state !== "saved"), ...fresh]);
    review.current?.showModal();
    for (const d of fresh) {
      pdfText(d.file)
        .then((text) => {
          const r = readInvoiceText(text);
          const line = suggestLine(data, r);
          const charge = suggestCharge(data, r, line);
          patchDraft(d.key, {
            state: "ready",
            warnings: r.warnings,
            lines: r.lines,
            form: {
              vendor: r.vendor,
              invoiceNo: r.invoiceNo,
              invoiceDate: r.invoiceDate,
              periodFrom: r.periodFrom,
              periodTo: r.periodTo,
              billTo: r.billTo,
              total: r.total === null ? "" : String(r.total),
              currency: r.currency,
              chargeId: charge ? String(charge.id) : "",
              statementLineId: line ? String(line.id) : "",
              notes: "",
            },
          });
        })
        .catch((e: Error) => patchDraft(d.key, { state: "ready", error: `${e.message} Fill in the details yourself.` }));
    }
  };

  const save = async (d: Draft) => {
    patchDraft(d.key, { state: "saving", error: "" });
    try {
      const lines = d.lines.length || !d.form.total ? d.lines : [{ description: `${d.form.vendor || "Invoice"} total`, projectRef: "", amount: Number(d.form.total), kind: "charge" as const }];
      const fd = new FormData();
      fd.set("data", JSON.stringify(body(d.form, lines)));
      fd.set("file", d.file);
      await api("/billing/invoices", { method: "POST", body: fd });
      patchDraft(d.key, { state: "saved" });
      await reload();
    } catch (e) {
      patchDraft(d.key, { state: "ready", error: (e as Error).message });
    }
  };

  const months = [...new Set(data.invoices.map((i) => monthOf(i.invoiceDate)))].sort().reverse();
  const vendors = [...new Set(data.invoices.map((i) => i.vendor))].sort();
  const shown = data.invoices.filter(
    (i) =>
      (!month || monthOf(i.invoiceDate) === month) &&
      (!vendor || i.vendor === vendor) &&
      (show === "all" || (show === "unpaid" ? i.statementLineId === null : i.chargeId === null)),
  );
  const refCharges = [...new Set(data.projectRefs.map((r) => r.chargeId))];
  const needle = refQ.trim().toLowerCase();
  const refsShown = data.projectRefs.filter(
    (r) =>
      (!refCharge || String(r.chargeId ?? "") === refCharge) &&
      (!refUse || String(r.inUse) === refUse) &&
      (!needle || `${r.ref} ${r.name} ${r.vendor}`.toLowerCase().includes(needle)),
  );

  const openEdit = (i: InvoiceRow) => {
    setEditing(i);
    setForm({ ...i, total: String(i.total), chargeId: i.chargeId ? String(i.chargeId) : "", statementLineId: i.statementLineId ? String(i.statementLineId) : "" });
    editDialog.current?.showModal();
  };
  const saveEdit = async () => {
    if (!editing || !form) return;
    const lines = data.invoiceLines.filter((l) => l.invoiceId === editing.id).map(({ description, projectRef, amount, kind }) => ({ description, projectRef, amount, kind }));
    await api(`/billing/invoices/${editing.id}`, json("PATCH", body(form, lines)));
    await reload();
  };
  const removeEdit = async () => {
    if (!editing) return;
    await api(`/billing/invoices/${editing.id}`, { method: "DELETE" });
    await reload();
  };

  const openRef = (r: ProjectRef) => {
    setRefEditing(r);
    setRefForm({ name: r.name, chargeId: r.chargeId ? String(r.chargeId) : "", inUse: String(r.inUse) });
    refDialog.current?.showModal();
  };
  const saveRef = async () => {
    if (!refEditing) return;
    await api(`/billing/refs/${encodeURIComponent(refEditing.ref)}`, json("PATCH", { name: refForm.name, chargeId: refForm.chargeId || null, inUse: refForm.inUse === "1" }));
    await reload();
  };

  const lineOf = (id: number | null) => data.lines.find((l) => l.id === id);
  const chargeOf = (id: number | null) => data.charges.find((c) => c.id === id);
  const waiting = drafts.filter((d) => d.state !== "saved").length;

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select className="input" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          <option value="">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthName(m)}
            </option>
          ))}
        </select>
        <select className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor">
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select className="input" value={show} onChange={(e) => setShow(e.target.value as typeof show)} aria-label="Show">
          <option value="all">All invoices</option>
          <option value="unpaid">Payment not found yet</option>
          <option value="nocharge">No charge picked</option>
        </select>
        <span className="text-xs text-ink-subtle">
          {shown.length} invoice(s)
          {(["USD", "MYR"] as const).map((cur) => {
            const t = shown.filter((i) => i.currency === cur).reduce((a, i) => a + i.total, 0);
            return t ? ` · ${money(t, cur)}` : "";
          })}{" "}
          · the PDF is read here, then kept privately in the hub
        </span>
        {canEdit && (
          <div className="ml-auto flex gap-2">
            {waiting > 0 && (
              <button className="btn-default" onClick={() => review.current?.showModal()}>
                {waiting} to check
              </button>
            )}
            <label className="btn-primary inline-flex cursor-pointer">
              <FileUp className="h-4 w-4" /> Add invoices
              <input
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="sr-only"
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        )}
      </div>

      {data.invoices.length === 0 && (
        <div className="card mt-4 p-6 text-center text-sm text-ink-subtle">
          No invoices yet. Download them from each vendor (Supabase, Cloudflare, Anthropic...) and use Add invoices; several at once is fine.
        </div>
      )}

      {shown.length > 0 && (
        <div className={`card mt-3 ${SCROLL}`}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["Date", "Vendor", "Invoice", "Charge", "Paid by", "Total", ""].map((h, i) => (
                  <th key={i} className={`${TH} ${STICKY} whitespace-nowrap ${h === "Total" ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const c = chargeOf(i.chargeId);
                const l = lineOf(i.statementLineId);
                return (
                  <tr
                    key={i.id}
                    // Anywhere on the row opens the invoice PDF; the pencil edits.
                    onClick={(e) => i.fileKey && !(e.target as HTMLElement).closest("a,button") && window.open(invoiceFileUrl(i.id), "_blank", "noopener")}
                    title={i.fileKey ? "Open the invoice PDF" : undefined}
                    className={`border-b border-line-subtle align-top last:border-0 ${i.fileKey ? "cursor-pointer hover:bg-surface-dim" : ""}`}
                  >
                    <td className="w-28 whitespace-nowrap px-3 py-2.5 pl-4 text-ink-subtle">{i.invoiceDate}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-ink">{i.vendor}</div>
                      {i.billTo && <div className="text-xs text-ink-subtlest">{i.billTo}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {i.fileKey ? (
                        <a className="inline-flex items-center gap-1 text-primary hover:underline" href={invoiceFileUrl(i.id)} target="_blank" rel="noreferrer">
                          <FileText className="h-3.5 w-3.5" /> {i.invoiceNo}
                        </a>
                      ) : (
                        i.invoiceNo
                      )}
                    </td>
                    <td className="px-3 py-2.5">{c ? <span className="text-ink">{chargeLabel(data, c)}</span> : <span className="pill bg-loz-orange text-loz-orange-ink">No charge</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {l ? <span className="text-ink-subtle">{lineLabel(l)}</span> : <span className="pill bg-loz-orange text-loz-orange-ink">Not found yet</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink">{money(i.total, i.currency)}</td>
                    <td className="w-12 px-3 py-2.5 pr-4 text-right">
                      {canEdit && (
                        <button className="btn-subtle h-8 w-8 px-0" title="Edit" aria-label={`Edit ${i.vendor} ${i.invoiceNo}`} onClick={() => openEdit(i)}>
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

      {data.projectRefs.length > 0 && (
        <section className="mt-6" aria-label="Project IDs">
          <h2 className="section-title">Project IDs on invoices</h2>
          <p className="mt-1 text-[12.5px] text-ink-subtle">Learned from the invoices. Name each one and say if it is still used; unused ones show on their system's tab.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className="input w-56" placeholder="Search ID or name" value={refQ} onChange={(e) => setRefQ(e.target.value)} aria-label="Search project IDs" />
            <select className="input" value={refCharge} onChange={(e) => setRefCharge(e.target.value)} aria-label="Account">
              <option value="">All accounts</option>
              {refCharges.map((id) => {
                const c = chargeOf(id);
                return (
                  <option key={String(id)} value={String(id ?? "")}>
                    {c ? chargeLabel(data, c) : "No charge"}
                  </option>
                );
              })}
            </select>
            <select className="input" value={refUse} onChange={(e) => setRefUse(e.target.value)} aria-label="In use">
              <option value="">Used or not</option>
              <option value="1">In use</option>
              <option value="0">Not used</option>
            </select>
            <span className="text-xs text-ink-subtle">
              {refsShown.length} of {data.projectRefs.length}
            </span>
          </div>
          {refsShown.length === 0 && <div className="py-6 text-center text-sm text-ink-subtle">No project IDs match.</div>}
          <div className={`card mt-2 ${SCROLL} ${refsShown.length ? "" : "hidden"}`}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {["Project ID", "Vendor", "Name", "Charge", "In use", ""].map((h, i) => (
                    <th key={i} className={`${TH} ${STICKY} text-left`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {refsShown.map((r) => {
                  const c = chargeOf(r.chargeId);
                  return (
                    <tr key={r.ref} className="border-b border-line-subtle last:border-0">
                      <td className="px-3 py-2 pl-4 font-mono text-[12px] text-ink">{r.ref}</td>
                      <td className="px-3 py-2 text-ink-subtle">{r.vendor}</td>
                      <td className="px-3 py-2">{r.name || <span className="text-loz-orange-ink">Not named</span>}</td>
                      <td className="px-3 py-2 text-ink-subtle">{c ? chargeLabel(data, c) : "-"}</td>
                      <td className="px-3 py-2">{r.inUse ? "Yes" : <span className="pill bg-loz-grey text-loz-grey-ink">Not used</span>}</td>
                      <td className="w-12 px-3 py-2 pr-4 text-right">
                        {canEdit && (
                          <button className="btn-subtle h-8 w-8 px-0" title="Edit" aria-label={`Edit ${r.ref}`} onClick={() => openRef(r)}>
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
        </section>
      )}

      <dialog ref={review} className="card w-[960px] max-w-[calc(100vw-32px)] p-0 text-ink backdrop:bg-black/40">
        <div className="flex items-center border-b border-line px-5 py-3">
          <span className="text-[15px] font-bold">Check invoices</span>
          <button className="btn-default ml-auto" onClick={() => review.current?.close()}>
            Close
          </button>
        </div>
        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-4">
          {drafts.length === 0 && <p className="text-sm text-ink-subtle">Nothing to check.</p>}
          {drafts.map((d) => (
            <DraftCard
              key={d.key}
              data={data}
              d={d}
              set={(p) => setDraftForm(d.key, p)}
              onSave={() => void save(d)}
              onSkip={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
            />
          ))}
        </div>
      </dialog>

      <EditDialog dialogRef={editDialog} title="Edit invoice" isNew={false} stamp={editing} onSave={saveEdit} onRemove={removeEdit} onClose={() => setEditing(null)}>
        {editing && form && (
          <>
            <Field label="Vendor" value={form.vendor} onChange={(v) => setForm({ ...form, vendor: v })} required />
            <Field label="Invoice number" value={form.invoiceNo} onChange={(v) => setForm({ ...form, invoiceNo: v })} required />
            <Field label="Invoice date" value={form.invoiceDate} onChange={(v) => setForm({ ...form, invoiceDate: v })} type="date" required />
            <Field label={`Total (${form.currency})`} value={form.total} onChange={(v) => setForm({ ...form, total: v })} type="number" required hint="Must still equal its lines" />
            <Select label="Charge" value={form.chargeId} onChange={(v) => setForm({ ...form, chargeId: v })} options={chargeOptions(data, form.vendor)} />
            <Select
              label="Paid by (card statement line)"
              value={form.statementLineId}
              onChange={(v) => setForm({ ...form, statementLineId: v })}
              options={[["", "Not found yet"], ...candidateLines(data, form, form.statementLineId).map((l) => [String(l.id), lineLabel(l)] as [string, string])]}
            />
            <Field label="Notes" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} area />
            <LinesTable lines={data.invoiceLines.filter((l) => l.invoiceId === editing.id)} currency={form.currency} refs={data.projectRefs} />
          </>
        )}
      </EditDialog>

      <EditDialog dialogRef={refDialog} title="Edit project ID" isNew={false} stamp={refEditing} onSave={saveRef} onRemove={async () => {}} onClose={() => setRefEditing(null)}>
        {refEditing && (
          <>
            <p className="font-mono text-[12px] text-ink sm:col-span-2">
              {refEditing.vendor} · {refEditing.ref}
            </p>
            <Field label="Name" value={refForm.name} onChange={(v) => setRefForm({ ...refForm, name: v })} hint="For example: Hookka production" />
            <Select label="Still in use?" value={refForm.inUse} onChange={(v) => setRefForm({ ...refForm, inUse: v })} options={[["1", "Yes"], ["0", "No, not used"]]} />
            <Select label="Charge" value={refForm.chargeId} onChange={(v) => setRefForm({ ...refForm, chargeId: v })} options={chargeOptions(data, refEditing.vendor)} />
          </>
        )}
      </EditDialog>
    </>
  );
}

function LinesTable({ lines, currency, refs }: { lines: { description: string; projectRef: string; amount: number; kind: string }[]; currency: string; refs: ProjectRef[] }) {
  if (!lines.length) return null;
  return (
    <div className="overflow-x-auto rounded border border-line sm:col-span-2">
      <table className="w-full border-collapse text-[12px]">
        <tbody>
          {lines.map((l, i) => {
            const ref = refs.find((r) => r.ref === l.projectRef);
            return (
              <tr key={i} className="border-b border-line-subtle last:border-0">
                <td className="px-2 py-1 text-ink-subtle">{l.kind === "charge" ? "" : l.kind}</td>
                <td className="px-2 py-1 font-mono text-[11px] text-ink-subtle">
                  {l.projectRef}
                  {ref?.name && <span className="ml-1 font-sans text-ink">{ref.name}</span>}
                  {ref && !ref.inUse && <span className="ml-1 font-sans text-ink-subtlest">(not used)</span>}
                </td>
                <td className="px-2 py-1 text-ink">{l.description}</td>
                <td className="px-2 py-1 text-right tabular-nums">{money(l.amount, currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DraftCard({ data, d, set, onSave, onSkip }: { data: Data; d: Draft; set: (p: Partial<Form>) => void; onSave: () => void; onSkip: () => void }) {
  const f = d.form;
  const dup = data.invoices.some((i) => i.vendor.toLowerCase() === f.vendor.toLowerCase() && i.invoiceNo === f.invoiceNo && f.invoiceNo);
  const orange = "border-loz-orange-ink";
  if (d.state === "saved")
    return (
      <section className="card border-loz-green-ink p-3 text-[13px] text-loz-green-ink">
        Saved: {f.vendor} {f.invoiceNo} · {money(Number(f.total), f.currency)}
      </section>
    );
  return (
    <section className="card p-4" aria-label={d.file.name}>
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="h-4 w-4 text-ink-subtle" />
        <span className="text-[13px] font-semibold text-ink">{d.file.name}</span>
        {d.state === "reading" && <span className="text-xs text-ink-subtle">Reading...</span>}
        {dup && <span className="pill bg-loz-grey text-loz-grey-ink">Already added</span>}
      </div>
      {d.state !== "reading" && (
        <>
          {[...d.warnings, d.error].filter(Boolean).map((w) => (
            <div key={w} role="alert" className="mt-2 rounded bg-loz-orange px-3 py-1.5 text-[12px] text-loz-orange-ink">
              {w}
            </div>
          ))}
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Field label="Vendor" value={f.vendor} onChange={(v) => set({ vendor: v })} />
            <Field label="Invoice number" value={f.invoiceNo} onChange={(v) => set({ invoiceNo: v })} />
            <Field label="Date" value={f.invoiceDate} onChange={(v) => set({ invoiceDate: v })} type="date" />
            <Field label={`Total (${f.currency})`} value={f.total} onChange={(v) => set({ total: v })} type="number" />
          </div>
          {f.billTo && <p className="mt-1 text-[12px] text-ink-subtle">Billed to: {f.billTo}</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className={f.chargeId ? "" : `rounded border-2 ${orange} p-1`}>
              <Select label="Charge (the account billed)" value={f.chargeId} onChange={(v) => set({ chargeId: v })} options={chargeOptions(data, f.vendor)} />
            </div>
            <div className={f.statementLineId ? "" : `rounded border-2 ${orange} p-1`}>
              <Select
                label="Paid by (card statement line)"
                value={f.statementLineId}
                onChange={(v) => set({ statementLineId: v })}
                options={[["", "Not found yet (statement not added?)"], ...candidateLines(data, f, f.statementLineId).map((l) => [String(l.id), lineLabel(l)] as [string, string])]}
              />
            </div>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] text-ink-subtle">{d.lines.length} line(s) read from the invoice</summary>
            <div className="mt-2 grid">
              <LinesTable lines={d.lines} currency={f.currency} refs={data.projectRefs} />
            </div>
          </details>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" disabled={d.state === "saving" || dup || !f.vendor || !f.invoiceNo || !f.invoiceDate || !f.total} onClick={onSave}>
              {d.state === "saving" ? "Saving..." : "Save"}
            </button>
            <button className="btn-default" onClick={onSkip}>
              Skip
            </button>
          </div>
        </>
      )}
    </section>
  );
}
