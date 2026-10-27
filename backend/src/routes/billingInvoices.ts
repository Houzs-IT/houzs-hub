import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { schema, type DB } from "../db/client";
import { CURRENCIES, INVOICE_LINE_KINDS } from "../db/schema";
import { need } from "../middleware/devAuth";
import { nowIso } from "../services/tickets";
import type { DevApp } from "../types";
import { isUniqueViolation } from "./admin";

// Vendor invoices for System billing, mounted at /billing/invoices inside routes/billing.ts.
// The page reads the PDF and sends what it found as JSON in a `data` field, with the PDF
// itself as `file`; the hub only checks and stores them. Saving an invoice links it to the
// statement line that paid it, matches that line to the invoice's charge, learns any new
// project IDs, and makes the invoice the charge's Latest bill when it is the newest.
const invoicesRoute = new Hono<DevApp>();
const inv = schema.invoices;
const il = schema.invoiceLines;
const ch = schema.charges;
const sl = schema.statementLines;
const pr = schema.projectRefs;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
type Body = Record<string, unknown>;
type Line = { description: string; projectRef: string; amount: string; kind: (typeof INVOICE_LINE_KINDS)[number] };
type Fields = {
  vendor: string;
  invoiceNo: string;
  invoiceDate: string;
  periodFrom: string | null;
  periodTo: string | null;
  billTo: string;
  total: string;
  currency: string;
  chargeId: number | null;
  statementLineId: number | null;
  notes: string;
};

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const money = (v: unknown) => {
  const n = Number(v);
  return v === "" || v === null || !Number.isFinite(n) || Math.abs(n) > 1e9 ? null : n;
};
const optDate = (v: unknown) => (typeof v === "string" && DATE_RE.test(v) ? v : null);
const optId = (v: unknown) => (v === null || v === "" || v === undefined ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);

function readInvoice(b: Body): { fields: Fields; lines: Line[] } | string {
  const vendor = s(b.vendor, 200);
  const invoiceNo = s(b.invoiceNo, 100);
  if (!vendor) return "Give the vendor";
  if (!invoiceNo) return "Give the invoice number";
  if (typeof b.invoiceDate !== "string" || !DATE_RE.test(b.invoiceDate)) return "Invoice date must be a date";
  const total = money(b.total);
  if (total === null) return "Total must be a number";
  if (!CURRENCIES.includes(b.currency as (typeof CURRENCIES)[number])) return "Currency: USD or MYR";
  const chargeId = optId(b.chargeId);
  const statementLineId = optId(b.statementLineId);
  if (Number.isNaN(chargeId)) return "Unknown charge";
  if (Number.isNaN(statementLineId)) return "Unknown statement line";
  if (!Array.isArray(b.lines)) return "Lines must be a list";
  if (b.lines.length > 200) return "200 lines at most";
  const lines: Line[] = [];
  for (const [i, raw] of b.lines.entries()) {
    const r = (raw ?? {}) as Body;
    const amount = money(r.amount);
    if (amount === null) return `Line ${i + 1}: amount must be a number`;
    if (!INVOICE_LINE_KINDS.includes(r.kind as Line["kind"])) return `Line ${i + 1}: unknown kind`;
    lines.push({ description: s(r.description, 300), projectRef: s(r.projectRef, 100), amount: amount.toFixed(2), kind: r.kind as Line["kind"] });
  }
  // The lines are the invoice split up, so they must come to its total (to the cent).
  const sum = lines.reduce((a, l) => a + Number(l.amount), 0);
  if (lines.length && Math.abs(sum - total) > 0.005) return `The lines add up to ${sum.toFixed(2)}, not the total ${total.toFixed(2)}`;
  return {
    fields: {
      vendor,
      invoiceNo,
      invoiceDate: b.invoiceDate,
      periodFrom: optDate(b.periodFrom),
      periodTo: optDate(b.periodTo),
      billTo: s(b.billTo, 300),
      total: total.toFixed(2),
      currency: b.currency as string,
      chargeId,
      statementLineId,
      notes: s(b.notes, 1000),
    },
    lines,
  };
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
class InputErr extends Error {}

// Everything that follows from an invoice's charge and payment, after it is saved.
async function applyLinks(tx: Tx, id: number, f: Fields, lines: Line[], user: string) {
  const now = nowIso();
  if (f.statementLineId !== null) {
    const [line] = await tx.select({ id: sl.id }).from(sl).where(eq(sl.id, f.statementLineId));
    if (!line) throw new InputErr("That statement line no longer exists");
  }
  const [charge] = f.chargeId === null ? [] : await tx.select().from(ch).where(eq(ch.id, f.chargeId));
  if (f.chargeId !== null && !charge) throw new InputErr("That charge no longer exists");
  if (!charge) return;

  // The statement line is matched through the invoice from now on.
  if (f.statementLineId !== null && charge.registerId) {
    await tx.update(sl).set({ registerId: charge.registerId, updatedAt: now, updatedBy: user }).where(eq(sl.id, f.statementLineId));
  }
  // New project IDs belong to this invoice's charge until a person says otherwise.
  const refs = [...new Set(lines.map((l) => l.projectRef).filter(Boolean))];
  for (const ref of refs) {
    await tx.insert(pr).values({ ref, vendor: f.vendor, chargeId: charge.id, updatedAt: now, updatedBy: user }).onConflictDoNothing();
  }
  // The newest invoice for a charge is its Latest bill.
  const [newest] = await tx
    .select({ id: inv.id })
    .from(inv)
    .where(eq(inv.chargeId, charge.id))
    .orderBy(desc(inv.invoiceDate), desc(inv.id))
    .limit(1);
  if (newest?.id === id) {
    await tx.update(ch).set({ amount: f.total, currency: f.currency, checkedOn: f.invoiceDate, updatedAt: now, updatedBy: user }).where(eq(ch.id, charge.id));
  }
}

const refuse = (e: unknown) => {
  if (e instanceof InputErr) return { error: e.message, status: 400 as const };
  if (isUniqueViolation(e)) {
    const msg = String((e as { constraint_name?: string; message?: string }).constraint_name ?? (e as Error).message);
    return msg.includes("statement_line")
      ? { error: "That statement line already pays another invoice", status: 409 as const }
      : { error: "This invoice is already added", status: 409 as const };
  }
  return null;
};

async function readBody(c: { req: { header(n: string): string | undefined; formData(): Promise<FormData>; json(): Promise<unknown> } }) {
  if (Number(c.req.header("Content-Length")) > MAX_PDF_BYTES + 512 * 1024) return "The PDF is larger than 10 MB";
  if ((c.req.header("Content-Type") ?? "").includes("multipart/form-data")) {
    const form = await c.req.formData();
    const data = form.get("data");
    const file = form.get("file");
    let body: Body = {};
    try {
      body = typeof data === "string" ? (JSON.parse(data) as Body) : {};
    } catch {
      return "Unreadable invoice data";
    }
    if (file !== null && typeof file !== "string") {
      if (file.size > MAX_PDF_BYTES) return "The PDF is larger than 10 MB";
      if (file.type !== "application/pdf") return "Only PDF invoices";
      return { body, file };
    }
    return { body, file: null };
  }
  return { body: ((await c.req.json().catch(() => ({}))) ?? {}) as Body, file: null };
}

invoicesRoute.post("/", need("billing_edit"), async (c) => {
  const input = await readBody(c);
  if (typeof input === "string") return c.json({ error: input }, 400);
  const r = readInvoice(input.body);
  if (typeof r === "string") return c.json({ error: r }, 400);
  const user = c.get("user").name;
  const now = nowIso();
  let fileKey: string | null = null;
  if (input.file) {
    const safe = input.file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "invoice.pdf";
    fileKey = `invoices/${crypto.randomUUID()}-${safe}`;
    await c.env.FILES.put(fileKey, input.file.stream(), { httpMetadata: { contentType: "application/pdf" } });
  }
  try {
    const id = await c.get("db").transaction(async (tx) => {
      const [row] = await tx
        .insert(inv)
        .values({ ...r.fields, fileKey, fileName: input.file?.name.slice(0, 200) ?? "", createdAt: now, updatedAt: now, updatedBy: user })
        .returning({ id: inv.id });
      if (r.lines.length) await tx.insert(il).values(r.lines.map((l) => ({ ...l, invoiceId: row!.id })));
      await applyLinks(tx, row!.id, r.fields, r.lines, user);
      return row!.id;
    });
    return c.json({ id }, 201);
  } catch (e) {
    if (fileKey) await c.env.FILES.delete(fileKey);
    const no = refuse(e);
    if (no) return c.json({ error: no.error }, no.status);
    throw e;
  }
});

invoicesRoute.patch("/:id", need("billing_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invoice not found" }, 404);
  const r = readInvoice(((await c.req.json().catch(() => ({}))) ?? {}) as Body);
  if (typeof r === "string") return c.json({ error: r }, 400);
  const user = c.get("user").name;
  try {
    const found = await c.get("db").transaction(async (tx) => {
      const [row] = await tx.update(inv).set({ ...r.fields, updatedAt: nowIso(), updatedBy: user }).where(eq(inv.id, id)).returning({ id: inv.id });
      if (!row) return false;
      await tx.delete(il).where(eq(il.invoiceId, id));
      if (r.lines.length) await tx.insert(il).values(r.lines.map((l) => ({ ...l, invoiceId: id })));
      await applyLinks(tx, id, r.fields, r.lines, user);
      return true;
    });
    if (!found) return c.json({ error: "Invoice not found" }, 404);
    return c.json({ ok: true });
  } catch (e) {
    const no = refuse(e);
    if (no) return c.json({ error: no.error }, no.status);
    throw e;
  }
});

// The statement line keeps the charge it was matched to; only the invoice and its PDF go.
invoicesRoute.delete("/:id", need("billing_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Invoice not found" }, 404);
  const [row] = await c.get("db").delete(inv).where(eq(inv.id, id)).returning({ fileKey: inv.fileKey });
  if (!row) return c.json({ error: "Invoice not found" }, 404);
  if (row.fileKey) await c.env.FILES.delete(row.fileKey);
  return c.json({ ok: true });
});

invoicesRoute.get("/:id/file", need("billing_view", "billing_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.text("Not found", 404);
  const [row] = await c.get("db").select({ fileKey: inv.fileKey, fileName: inv.fileName }).from(inv).where(eq(inv.id, id));
  const obj = row?.fileKey ? await c.env.FILES.get(row.fileKey) : null;
  if (!obj) return c.text("Not found", 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${(row!.fileName || "invoice.pdf").replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
});

export default invoicesRoute;

// --- Project IDs -----------------------------------------------------------

export const refsRoute = new Hono<DevApp>();

refsRoute.patch("/:ref", need("billing_edit"), async (c) => {
  const ref = c.req.param("ref");
  const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Body;
  const set: Partial<typeof pr.$inferInsert> = { updatedAt: nowIso(), updatedBy: c.get("user").name };
  if ("name" in b) set.name = s(b.name, 200);
  if ("inUse" in b) set.inUse = b.inUse ? 1 : 0;
  if ("chargeId" in b) {
    const id = optId(b.chargeId);
    if (Number.isNaN(id)) return c.json({ error: "Unknown charge" }, 400);
    set.chargeId = id;
  }
  const [row] = await c.get("db").update(pr).set(set).where(eq(pr.ref, ref)).returning();
  if (!row) return c.json({ error: "Project ID not found" }, 404);
  return c.json({ ref: row });
});
