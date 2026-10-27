// Reads a vendor invoice from the text of its PDF (lib/pdfText.ts gives one line per printed
// row, pieces joined by two spaces). Known layouts: Supabase (cost per project ID), Cloudflare
// and Anthropic (Stripe invoices). Anything else gets the general fields when they can be
// found; the person fills in the rest. Nothing here talks to the hub.

export type InvoiceLineKind = "charge" | "tax" | "discount" | "rounding";
export type ReadLine = { description: string; projectRef: string; amount: number; kind: InvoiceLineKind };
export type ReadInvoice = {
  vendor: string;
  invoiceNo: string;
  invoiceDate: string;
  periodFrom: string | null;
  periodTo: string | null;
  billTo: string;
  total: number | null;
  currency: "USD" | "MYR";
  lines: ReadLine[];
  warnings: string[];
};

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
const VENDORS: [RegExp, string][] = [
  [/Supabase Pte/i, "Supabase"],
  [/Cloudflare, Inc/i, "Cloudflare"],
  [/Anthropic, PBC/i, "Anthropic"],
];
const VENDOR_MAIL = /@(supabase|cloudflare|anthropic|stripe)\./i;
const PROJECT_REF = /^[a-z]{20}$/; // Supabase project IDs
const AMT = String.raw`([\d,]+\.\d{2})`;
const num = (s: string) => Number(s.replace(/,/g, ""));

// "Oct 17, 2026" / "October 17, 2026" / "17/10/2026" to 2026-10-17.
function date(s: string): string | null {
  let m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1]!.toLowerCase()]) return `${m[3]}-${MONTHS[m[1]!.toLowerCase()]}-${m[2]!.padStart(2, "0")}`;
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null;
}

// Characters the PDF font could not map come through as control characters; they stand for
// hyphens, dashes and brackets, so they become spaces and the patterns allow for them.
const clean = (l: string) => l.replace(/[\u0000-\u001f�]/g, " ").replace(/\s+$/, "");

export function readInvoiceText(text: string): ReadInvoice {
  const rows = text.split("\n").map(clean).filter((l) => l.trim());
  const all = rows.join("\n");
  const out: ReadInvoice = { vendor: "", invoiceNo: "", invoiceDate: "", periodFrom: null, periodTo: null, billTo: "", total: null, currency: "USD", lines: [], warnings: [] };

  out.vendor = VENDORS.find(([re]) => re.test(all))?.[1] ?? "";

  for (const r of rows) {
    const no = r.match(/Invoice\s+(?:number|no\.?|#)\s*:?\s+(.+)$/i);
    if (no && !out.invoiceNo) out.invoiceNo = no[1]!.trim().replace(/\s+/g, "-");
    const d = r.match(/(?:Invoice date|Date of issue|Invoice Date)\s*:?\s+(.+)$/i);
    if (d && !out.invoiceDate) out.invoiceDate = date(d[1]!) ?? "";
    const p = r.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\W+([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})/);
    if (p && !out.periodFrom && MONTHS[p[1]!.toLowerCase()] && MONTHS[p[3]!.toLowerCase()]) {
      const [m1, m2] = [MONTHS[p[1]!.toLowerCase()]!, MONTHS[p[3]!.toLowerCase()]!];
      const y2 = Number(p[5]);
      out.periodFrom = `${m1 > m2 ? y2 - 1 : y2}-${m1}-${p[2]!.padStart(2, "0")}`;
      out.periodTo = `${y2}-${m2}-${p[4]!.padStart(2, "0")}`;
    }
    const t = r.match(new RegExp(String.raw`^Amount due\s+(RM|MYR|USD|\$)\s?${AMT}`, "i"));
    if (t) {
      out.total = num(t[2]!);
      out.currency = /RM|MYR/i.test(t[1]!) ? "MYR" : "USD";
    }
  }

  // Bill to: the account the invoice is for, plus the billing email, which tells apart two
  // accounts with the same holder's name.
  const at = rows.findIndex((r) => /Bill to/i.test(r));
  if (at >= 0) {
    const after = rows[at]!.replace(/^.*Bill to:?/i, "").trim();
    const next = rows[at + 1] ?? "";
    const name = after && !/Invoice/i.test(after) ? after : (next.split(/\s{2,}/).pop() ?? "").trim();
    const mail = all.match(/[\w.+-]+@[\w-]+\.[\w.]+/g)?.find((m) => !VENDOR_MAIL.test(m)) ?? "";
    out.billTo = [name, mail].filter(Boolean).join(" · ");
  }

  out.lines = readLines(rows);
  const sum = out.lines.reduce((a, l) => a + l.amount, 0);
  if (out.total !== null) {
    const diff = Math.round((out.total - sum) * 100) / 100;
    // Vendors round each line, so the lines can be a cent or two off their own total.
    if (out.lines.length && diff !== 0 && Math.abs(diff) <= 0.05) out.lines.push({ description: "Rounding", projectRef: "", amount: diff, kind: "rounding" });
    else if (!out.lines.length || diff !== 0) {
      if (out.lines.length) out.warnings.push(`The lines came to ${sum.toFixed(2)}, not the total ${out.total.toFixed(2)}, so the invoice is kept as one line.`);
      out.lines = [{ description: out.vendor ? `${out.vendor} invoice` : "Invoice total", projectRef: "", amount: out.total, kind: "charge" }];
    }
  }
  if (!out.vendor) out.warnings.push("Vendor not recognised: pick it.");
  if (!out.invoiceNo) out.warnings.push("Invoice number not found: type it.");
  if (!out.invoiceDate) out.warnings.push("Invoice date not found: type it.");
  if (out.total === null) out.warnings.push("Total not found: type it.");
  out.lines = out.lines.map((l) => ({ ...l, amount: Math.round(l.amount * 100) / 100 }));
  return out;
}

// The lines that cost money: "Description  Qty  $Unit  [8%]  $Amount" rows, discounts, and the
// tax line. Supabase prints a heading per product, then one row per project ID; a project row
// can be split across a page break (ID at the bottom of one page, numbers at the top of the next).
function readLines(rows: string[]): ReadLine[] {
  const lines: ReadLine[] = [];
  let product = "";
  let pendingRef = "";
  const row = new RegExp(String.raw`^(.+?)\s{2,}([\d,]+(?:\.\d+)?)\s{2,}\$[\d,]*\.?\d+(?:\s{2,}\d+%)?\s{2,}(-?)\$${AMT}$`);
  const refRest = new RegExp(String.raw`^([\d,]+(?:\.\d+)?)\s{2,}\$[\d,]*\.?\d+(?:\s{2,}\d+%)?\s{2,}(-?)\$${AMT}$`);
  const heading = new RegExp(String.raw`^([A-Za-z][^$]*?)\s{2,}\$${AMT}$`);
  const add = (description: string, projectRef: string, amount: number, kind: InvoiceLineKind) => {
    if (amount !== 0) lines.push({ description, projectRef, amount, kind });
  };

  for (const r of rows) {
    const t = r.trim();
    if (/^(Subtotal|Total|Amount due|Description\s{2,})/i.test(t)) continue;
    if (PROJECT_REF.test(t)) {
      pendingRef = t;
      continue;
    }
    if (pendingRef) {
      const m = t.match(refRest);
      if (m) {
        add(product, pendingRef, num(m[3]!) * (m[2] ? -1 : 1), "charge");
        pendingRef = "";
        continue;
      }
      if (!/^Page|\d+ of \d+$/i.test(t)) pendingRef = "";
    }
    const tax = t.match(new RegExp(String.raw`^(.*?)\s+\d+(?:\.\d+)?%\s*on\s*\$[\d,.]+\s+\$${AMT}$`, "i"));
    if (tax) {
      add(tax[1]!.replace(/\s+/g, " ").trim() || "Tax", "", num(tax[2]!), "tax");
      continue;
    }
    const disc = t.match(new RegExp(String.raw`^(Discount.*?)\s{2,}-\$${AMT}$`, "i"));
    if (disc) {
      add(product ? `${product}: ${disc[1]}` : disc[1]!, "", -num(disc[2]!), "discount");
      continue;
    }
    const m = t.match(row);
    if (m) {
      // "Workers CPU ms (first 30M are included)" reads as "Workers CPU ms".
      const desc = m[1]!.replace(/\s+/g, " ").replace(/\s*\(?\s*first\b.*included\)?$/i, "").trim();
      const amount = num(m[4]!) * (m[3] ? -1 : 1);
      if (PROJECT_REF.test(desc)) add(product, desc, amount, "charge");
      else add(desc, "", amount, "charge");
      continue;
    }
    const h = t.match(heading);
    if (h) product = h[1]!.replace(/\s+/g, " ").trim();
  }
  return lines;
}
