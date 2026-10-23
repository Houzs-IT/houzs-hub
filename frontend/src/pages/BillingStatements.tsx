import { ClipboardPaste, Pencil, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api, json, type BillingData as Data, type ChargeRow, type StatementLine } from "../api/client";
import { EditDialog, Field, Select } from "../components/EditForm";
import { money } from "../lib/format";

// The card-statement side of the Billing page: the sheet's Statement lines,
// Monthly tally and Trend tabs. Amounts here are ringgit as charged to the card.

const NOT_MATCHED = "Not matched";
const TH = "border-b-2 border-line bg-surface-dim px-3 py-2.5 text-[10px] font-bold uppercase tracking-brand text-ink-subtle first:pl-4 last:pr-4";
const rm = (n: number) => money(n, "MYR");
const monthOf = (d: string) => d.slice(0, 7);
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-MY", { month: "short", year: "numeric" });
const thisMonth = () => new Date().toISOString().slice(0, 7);

function lookup(data: Data) {
  const byId = new Map(data.charges.filter((c) => c.registerId).map((c) => [c.registerId, c]));
  const companyOf = (l: StatementLine) => byId.get(l.registerId)?.company || NOT_MATCHED;
  const isAi = (l: StatementLine) => byId.get(l.registerId)?.serviceType.toLowerCase() === "ai";
  const companies = [...new Set(data.charges.map((c) => c.company).filter(Boolean))].sort();
  return { byId, companyOf, isAi, companies };
}

const sum = (lines: StatementLine[]) => lines.reduce((a, l) => a + l.amountMyr, 0);
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : "-");

// A charge is picked for a statement line only when the vendor name points at exactly
// one sheet ID (after narrowing to the card, if one is given); otherwise it is left for a person.
function guessCharge(charges: ChargeRow[], description: string, card: string): string {
  const desc = description.toLowerCase();
  let hits = charges.filter((c) => {
    const word = c.vendor.toLowerCase().match(/[a-z0-9]+/)?.[0] ?? "";
    return word.length >= 4 && desc.includes(word);
  });
  if (card && hits.some((c) => c.card === card)) hits = hits.filter((c) => c.card === card);
  const ids = [...new Set(hits.map((c) => c.registerId).filter(Boolean))];
  return ids.length === 1 ? ids[0]! : "";
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
function parseDate(s: string): string | null {
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // Malaysian banks write day first
  if (m) return `${m[3]!.length === 2 ? `20${m[3]}` : m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{2,4})$/);
  if (m && MONTHS[m[2]!.toLowerCase()]) return `${m[3]!.length === 2 ? `20${m[3]}` : m[3]}-${MONTHS[m[2]!.toLowerCase()]}-${m[1]!.padStart(2, "0")}`;
  return null;
}
function parseAmount(s: string): number | null {
  const credit = /CR\b|^\(.*\)$|^-/i.test(s.trim());
  const n = Number(s.replace(/RM|MYR|CR|DR|[(),\s-]/gi, ""));
  if (!s.trim() || !Number.isFinite(n)) return null;
  return credit ? -n : n;
}
function splitRow(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// A card statement copied from its PDF: "24 SEP SUPABASE SINGAPORE SG 692.36", with no year
// and spaces between the columns. The year is the latest one that does not put the date in the future.
const PDF_ROW = /^(\d{1,2})\s+([A-Za-z]{3})(?:\s+(\d{4}))?\s+(.+?)\s+(\(?-?[\d,]+\.\d{2}\)?(?:\s*CR)?)$/i;
// The foreign amount the bank prints under a charge: "USD 37.86". Kept as that line's note.
const FOREIGN = /^([A-Z]{3})\s+([\d,]+\.\d{2})$/;
function pdfRow(line: string): Parsed | null {
  const m = line.match(PDF_ROW);
  const mon = m && MONTHS[m[2]!.toLowerCase()];
  const amount = m && parseAmount(m[5]!);
  if (!m || !mon || amount == null) return null;
  const day = m[1]!.padStart(2, "0");
  let year = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (!m[3] && `${year}-${mon}-${day}` > today()) year -= 1;
  return { txnDate: `${year}-${mon}-${day}`, description: m[4]!.trim(), amountMyr: amount, notes: "" };
}

type Parsed = { txnDate: string; description: string; amountMyr: number; notes: string };
// Rows of Date, Description, Amount, as copied from a bank statement, its PDF or its CSV.
// Anything else (headers, totals, blank lines) is skipped and counted.
function parseStatement(text: string): { rows: Parsed[]; skipped: number } {
  const rows: Parsed[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const foreign = line.match(FOREIGN);
    const last = rows[rows.length - 1];
    if (foreign && last && !last.notes) {
      last.notes = `${foreign[1]} ${foreign[2]}`;
      continue;
    }
    const cells = splitRow(line).map((c) => c.trim());
    const date = parseDate(cells[0] ?? "");
    const amount = parseAmount(cells[cells.length - 1] ?? "");
    const description = cells.slice(1, -1).join(" ").trim();
    const row = date && amount !== null && description ? { txnDate: date, description, amountMyr: amount, notes: "" } : pdfRow(line);
    if (row) rows.push(row);
    else skipped += 1;
  }
  return { rows, skipped };
}

// A pasted line already saved on the same card: same date, amount and description.
const sameLine = (a: { txnDate: string; amountMyr: number; description: string }, b: StatementLine, card: string) =>
  a.txnDate === b.txnDate && a.amountMyr === b.amountMyr && a.description.toLowerCase() === b.description.toLowerCase() && b.card === card;

// ---------------------------------------------------------------------------

type LineDraft = { txnDate: string; card: string; description: string; registerId: string; amountMyr: string; notes: string };
const today = () => new Date().toISOString().slice(0, 10);

export function Statements({ data, setData, canEdit }: { data: Data; setData: (d: Data) => void; canEdit: boolean }) {
  const { byId } = lookup(data);
  const months = useMemo(() => [...new Set(data.lines.map((l) => monthOf(l.txnDate)))].sort().reverse(), [data.lines]);
  const [month, setMonth] = useState(months[0] ?? "");
  const [card, setCard] = useState("");
  const [unmatched, setUnmatched] = useState(false);
  const [editing, setEditing] = useState<StatementLine | "new" | null>(null);
  const [draft, setDraft] = useState<LineDraft>({ txnDate: today(), card: "", description: "", registerId: "", amountMyr: "", notes: "" });
  const dialog = useRef<HTMLDialogElement>(null);
  const pasteDialog = useRef<HTMLDialogElement>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteCard, setPasteCard] = useState("");

  const chargeOptions: [string, string][] = [
    ["", NOT_MATCHED],
    ...data.charges.filter((c) => c.registerId).map((c) => [c.registerId, `${c.registerId} ${c.vendor}${c.company ? ` (${c.company})` : ""}`] as [string, string]),
  ];
  const cardOptions: [string, string][] = [["", "Not known"], ...data.cards.map((c) => [c.nickname, c.nickname] as [string, string])];

  const shown = data.lines.filter(
    (l) => (!month || monthOf(l.txnDate) === month) && (!card || l.card === card) && (!unmatched || !byId.has(l.registerId)),
  );

  const open = (l: StatementLine | "new") => {
    setEditing(l);
    setDraft(
      l === "new"
        ? { txnDate: today(), card: "", description: "", registerId: "", amountMyr: "", notes: "" }
        : { ...l, amountMyr: String(l.amountMyr) },
    );
    dialog.current?.showModal();
  };
  const save = async () => {
    const body = { ...draft, amountMyr: draft.amountMyr === "" ? null : Number(draft.amountMyr) };
    if (editing === "new") {
      const { line } = await api<{ line: StatementLine }>("/billing/lines", json("POST", body));
      setData({ ...data, lines: [line, ...data.lines] });
    } else if (editing) {
      const { line } = await api<{ line: StatementLine }>(`/billing/lines/${editing.id}`, json("PATCH", body));
      setData({ ...data, lines: data.lines.map((x) => (x.id === line.id ? line : x)) });
    }
  };
  const remove = async () => {
    if (!editing || editing === "new") return;
    await api(`/billing/lines/${editing.id}`, { method: "DELETE" });
    setData({ ...data, lines: data.lines.filter((x) => x.id !== editing.id) });
  };

  const parsed = parseStatement(pasteText);
  // Pasting the same statement twice would count its charges twice, so lines already saved are left out.
  const fresh = parsed.rows.filter((r) => !data.lines.some((l) => sameLine(r, l, pasteCard)));
  const repeats = parsed.rows.length - fresh.length;
  const addPasted = async () => {
    if (parsed.rows.length === 0) throw new Error("No lines found. Each line needs a date, a description and an amount.");
    if (fresh.length === 0) throw new Error("Every line here is already saved on this card.");
    const lines = fresh.map((r) => ({ ...r, card: pasteCard, registerId: guessCharge(data.charges, r.description, pasteCard) }));
    const res = await api<{ lines: StatementLine[] }>("/billing/lines/bulk", json("POST", { lines }));
    setData({ ...data, lines: [...res.lines, ...data.lines] });
    setPasteText("");
    setMonth(monthOf(res.lines[0]!.txnDate));
  };
  const set = (k: keyof LineDraft) => (v: string) => setDraft({ ...draft, [k]: v });

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
        <select className="input" value={card} onChange={(e) => setCard(e.target.value)} aria-label="Card">
          <option value="">Any card</option>
          {data.cards.map((c) => (
            <option key={c.id}>{c.nickname}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-subtle">
          <input type="checkbox" checked={unmatched} onChange={(e) => setUnmatched(e.target.checked)} /> Not matched only
        </label>
        <span className="text-xs text-ink-subtle">
          {shown.length} line(s) · {rm(sum(shown))}
        </span>
        {canEdit && (
          <div className="ml-auto flex gap-2">
            <button className="btn-default" onClick={() => pasteDialog.current?.showModal()}>
              <ClipboardPaste className="h-4 w-4" /> Paste statement
            </button>
            <button className="btn-primary" onClick={() => open("new")}>
              <Plus className="h-4 w-4" /> Add line
            </button>
          </div>
        )}
      </div>

      {data.lines.length === 0 && (
        <div className="card mt-4 p-6 text-center text-sm text-ink-subtle">
          No statement lines yet. Copy the software and AI charges from a card statement and use Paste statement, or add them one by one.
        </div>
      )}
      {data.lines.length > 0 && shown.length === 0 && <div className="py-12 text-center text-sm text-ink-subtle">No lines match.</div>}

      {shown.length > 0 && (
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["Date", "Card", "As printed on the statement", "Matched to", "Amount", ""].map((h, i) => (
                  <th key={i} className={`${TH} ${h === "Amount" ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => {
                const c = byId.get(l.registerId);
                return (
                  <tr key={l.id} className="border-b border-line-subtle align-top last:border-0">
                    <td className="w-28 whitespace-nowrap px-3 py-2.5 pl-4 text-ink-subtle">{l.txnDate}</td>
                    <td className="w-32 px-3 py-2.5 text-ink-subtle">{l.card || "-"}</td>
                    <td className="px-3 py-2.5 text-ink">{l.description}</td>
                    <td className="w-56 px-3 py-2.5">
                      {c ? (
                        <>
                          <div className="text-ink">
                            {c.registerId} {c.vendor}
                          </div>
                          <div className="text-xs text-ink-subtle">{[c.company, c.system].filter(Boolean).join(" · ")}</div>
                        </>
                      ) : (
                        <span className="pill bg-loz-orange text-loz-orange-ink">{NOT_MATCHED}</span>
                      )}
                    </td>
                    <td className="w-32 whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink">{rm(l.amountMyr)}</td>
                    <td className="w-12 px-3 py-2.5 pr-4 text-right">
                      {canEdit && (
                        <button className="btn-subtle h-8 w-8 px-0" title="Edit" aria-label={`Edit ${l.txnDate} ${l.description}`} onClick={() => open(l)}>
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

      <EditDialog
        dialogRef={dialog}
        title={editing === "new" ? "Add statement line" : "Edit statement line"}
        isNew={editing === "new"}
        stamp={editing && editing !== "new" ? editing : null}
        onSave={save}
        onRemove={remove}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <>
            <Field label="Date on statement" value={draft.txnDate} onChange={set("txnDate")} type="date" required />
            <Select label="Card" value={draft.card} onChange={set("card")} options={cardOptions} />
            <Field
              label="As printed on the statement"
              value={draft.description}
              onChange={(v) => setDraft({ ...draft, description: v, registerId: draft.registerId || guessCharge(data.charges, v, draft.card) })}
              hint="For example: CLOUDFLARE SAN FRANCISCO"
            />
            <Field label="Amount charged (RM)" value={draft.amountMyr} onChange={set("amountMyr")} type="number" required hint="A refund is a minus amount" />
            <Select label="Matched to" value={draft.registerId} onChange={set("registerId")} options={chargeOptions} />
            <Field label="Notes" value={draft.notes} onChange={set("notes")} />
          </>
        )}
      </EditDialog>

      <EditDialog dialogRef={pasteDialog} title="Paste statement" isNew stamp={null} onSave={addPasted} onRemove={async () => {}} onClose={() => {}} saveLabel="Add lines">
        <div className="sm:col-span-2 text-[13px] text-ink-subtle">
          Copy the software and AI lines from the bank statement (its PDF or CSV), one per line: <b>date</b>, <b>description</b>, <b>amount</b>.
          Dates like 03/09/2026 are read day first; a date without a year (24 SEP) gets the latest year that is not in the future. A foreign amount
          on the next line (USD 37.86) is kept as the line's note. Each line is matched to a charge by its vendor name when that is clear; the rest
          stay Not matched for you to pick. Lines already saved on the card are left out.
        </div>
        <label className="block text-[12px] font-semibold text-ink-subtle sm:col-span-2">
          Statement lines
          <textarea
            className="input mt-1 h-auto min-h-[160px] w-full py-2 font-mono text-[12px]"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"24 SEP SUPABASE SINGAPORE SG 692.36\nUSD 165.89\n03/09/2026, CLOUDFLARE SAN FRANCISCO, 25.30"}
          />
        </label>
        <Select label="Card these lines are on" value={pasteCard} onChange={setPasteCard} options={cardOptions} />
        <div className="self-end text-[13px] text-ink-subtle">
          {fresh.length} line(s) to add{repeats ? `, ${repeats} already saved` : ""}
          {parsed.skipped ? `, ${parsed.skipped} skipped` : ""} · {rm(fresh.reduce((a, r) => a + r.amountMyr, 0))}
        </div>
        {fresh.length > 0 && (
          <ul className="max-h-40 overflow-auto text-[12px] text-ink-subtle sm:col-span-2">
            {fresh.map((r, i) => (
              <li key={i} className="flex gap-2 tabular-nums">
                <span className="w-20 shrink-0">{r.txnDate}</span>
                <span className="flex-1 truncate">{r.description}</span>
                {r.notes && <span>{r.notes}</span>}
                <span className="w-24 shrink-0 text-right">{rm(r.amountMyr)}</span>
              </li>
            ))}
          </ul>
        )}
      </EditDialog>
    </>
  );
}

// ---------------------------------------------------------------------------

export function Monthly({ data }: { data: Data }) {
  const { companyOf, companies } = lookup(data);
  const months = [...new Set([thisMonth(), ...data.lines.map((l) => monthOf(l.txnDate))])].sort().reverse();
  const latest = [...new Set(data.lines.map((l) => monthOf(l.txnDate)))].sort().reverse()[0] ?? thisMonth();
  const [month, setMonth] = useState(latest);
  const lines = data.lines.filter((l) => monthOf(l.txnDate) === month);
  const total = sum(lines);
  const groups = [...companies, NOT_MATCHED];
  const cards = [...new Set(lines.map((l) => l.card || "Card not known"))].sort();

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select className="input" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {months.map((m) => (
            <option key={m} value={m}>
              {monthName(m)}
            </option>
          ))}
        </select>
        <div className="card px-4 py-2">
          <span className="section-title">Total for the month</span>
          <div className="text-[22px] font-extrabold tabular-nums text-ink">{rm(total)}</div>
        </div>
        <span className="text-xs text-ink-subtle">{lines.length} statement line(s), as charged to the cards</span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card overflow-x-auto" aria-label="By company">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["By company", "Amount", "% of month"].map((h, i) => (
                  <th key={h} className={`${TH} ${i ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const amt = sum(lines.filter((l) => companyOf(l) === g));
                return (
                  <tr key={g} className="border-b border-line-subtle last:border-0">
                    <td className={`px-3 py-2 pl-4 ${g === NOT_MATCHED ? "text-loz-orange-ink" : "text-ink"}`}>{g}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{rm(amt)}</td>
                    <td className="px-3 py-2 pr-4 text-right tabular-nums text-ink-subtle">{pct(amt, total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section className="card overflow-x-auto" aria-label="By card">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {["By card", "Lines", "Amount"].map((h, i) => (
                  <th key={h} className={`${TH} ${i ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cards.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-ink-subtle">
                    Nothing on the cards this month yet.
                  </td>
                </tr>
              )}
              {cards.map((cn) => {
                const ls = lines.filter((l) => (l.card || "Card not known") === cn);
                return (
                  <tr key={cn} className="border-b border-line-subtle last:border-0">
                    <td className="px-3 py-2 pl-4 text-ink">{cn}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{ls.length}</td>
                    <td className="px-3 py-2 pr-4 text-right tabular-nums">{rm(sum(ls))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

export function Trend({ data }: { data: Data }) {
  const { companyOf, isAi, companies } = lookup(data);
  // From the first statement month (or six months back) to this month, at most two years.
  const first = data.lines.map((l) => monthOf(l.txnDate)).sort()[0];
  const start = new Date(`${first ?? thisMonth()}-01T00:00:00`);
  if (!first) start.setMonth(start.getMonth() - 5);
  const months: string[] = [];
  for (const d = new Date(start); months.length < 24; d.setMonth(d.getMonth() + 1)) {
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push(m);
    if (m >= thisMonth()) break;
  }
  const rows = months.map((m) => {
    const ls = data.lines.filter((l) => monthOf(l.txnDate) === m);
    return { m, total: sum(ls), ai: sum(ls.filter(isAi)), by: companies.map((co) => sum(ls.filter((l) => companyOf(l) === co))) };
  });
  const peak = Math.max(1, ...rows.map((r) => r.total));

  return (
    <>
      <p className="mt-4 text-[13px] text-ink-subtle">
        Card charges by month, in ringgit, from the Statements tab. AI is every charge matched to a service of type AI.
      </p>
      <div className="card mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {["Month", "Total", ...companies, "AI", "AI share", "vs last month", ""].map((h, i) => (
                <th key={`${h}${i}`} className={`${TH} ${i === 0 || i === companies.length + 5 ? "text-left" : "text-right"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const prev = rows[i - 1]?.total ?? 0;
              const change = prev && r.total ? Math.round((r.total / prev - 1) * 1000) / 10 : null;
              return (
                <tr key={r.m} className="border-b border-line-subtle last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 pl-4 text-ink">{monthName(r.m)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{rm(r.total)}</td>
                  {r.by.map((v, k) => (
                    <td key={k} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-subtle">
                      {rm(v)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink-subtle">{rm(r.ai)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-subtle">{pct(r.ai, r.total)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${change === null ? "text-ink-subtlest" : change > 0 ? "text-loz-red-ink" : "text-loz-green-ink"}`}>
                    {change === null ? "-" : `${change > 0 ? "+" : ""}${change}%`}
                  </td>
                  <td className="w-40 px-3 py-2 pr-4">
                    <div className="h-2 rounded bg-surface-dim">
                      <div className="h-2 rounded bg-primary" style={{ width: `${(r.total / peak) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
