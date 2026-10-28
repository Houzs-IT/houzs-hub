import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { schema, type DB } from "../db/client";
import { BILLING_SYSTEM_CODES, BILLING_SYSTEMS, CHARGE_BILLED, CHARGE_STATUSES, CURRENCIES } from "../db/schema";
import { need } from "../middleware/devAuth";
import { nowIso } from "../services/tickets";
import type { DevApp } from "../types";
import { isUniqueViolation } from "./admin";
import invoicesRoute, { refsRoute } from "./billingInvoices";
import { syncAnthropicCosts, UsageSetupError } from "../services/anthropicUsage";

// The Billing page: charges (the sheet's Register) and company cards (its Cards tab).
// Totals are worked out on the page. Mounted inside routes/dev.ts, after devAuth.
const billing = new Hono<DevApp>();
const ch = schema.charges;
const cd = schema.cards;
const sl = schema.statementLines;
const sp = schema.chargeSplits;

const MAX_TEXT = 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Body = Record<string, unknown>;
type Read<T> = T | string;
type Split = { systemCode: string; percent: number };

function text(b: Body, key: string, out: Record<string, unknown>, opts: { required?: string; max?: number } = {}): string | null {
  if (!(key in b)) return null;
  if (typeof b[key] !== "string") return `${key} must be text`;
  const v = (b[key] as string).trim();
  if (opts.required && !v) return opts.required;
  if (v.length > (opts.max ?? MAX_TEXT)) return `${key}: ${opts.max ?? MAX_TEXT} characters at most`;
  out[key] = v;
  return null;
}

function readCharge(b: Body, isNew: boolean): Read<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (isNew && !("vendor" in b)) return "Give the vendor";
  const errors = [
    text(b, "vendor", out, { required: "Give the vendor", max: 200 }),
    ...["registerId", "company", "system", "serviceType", "usedFor", "plan", "card", "keyName", "projectRef", "module", "notes"].map((k) =>
      text(b, k, out),
    ),
  ].filter(Boolean);
  if (errors.length) return errors[0] as string;
  if ("amount" in b) {
    if (b.amount === null || b.amount === "") out.amount = null;
    else {
      const n = Number(b.amount);
      if (!Number.isFinite(n) || n < 0 || n > 1e9) return "Amount must be a number of 0 or more";
      out.amount = n.toFixed(2);
    }
  }
  if ("currency" in b) {
    if (!CURRENCIES.includes(b.currency as (typeof CURRENCIES)[number])) return "Currency: USD or MYR";
    out.currency = b.currency;
  }
  if ("billed" in b) {
    if (!CHARGE_BILLED.includes(b.billed as (typeof CHARGE_BILLED)[number])) return "Billed: monthly, yearly, per credit, per use or blank";
    out.billed = b.billed;
  }
  if ("status" in b) {
    if (!CHARGE_STATUSES.includes(b.status as (typeof CHARGE_STATUSES)[number])) return "Unknown status";
    out.status = b.status;
  }
  if ("checkedOn" in b) {
    if (b.checkedOn === null || b.checkedOn === "") out.checkedOn = null;
    else if (typeof b.checkedOn === "string" && DATE_RE.test(b.checkedOn)) out.checkedOn = b.checkedOn;
    else return "Last checked must be a date";
  }
  if ("systemCode" in b) {
    if (b.systemCode !== "" && !BILLING_SYSTEM_CODES.includes(b.systemCode as string)) return "Unknown system";
    out.systemCode = b.systemCode;
  }
  if ("splitByUsage" in b) out.splitByUsage = b.splitByUsage ? 1 : 0;
  if ("splits" in b) {
    const s = readSplits(b.splits);
    if (typeof s === "string") return s;
    out.splits = s;
    // A charge is either one system's or shared; never both.
    if (s.length) out.systemCode = "";
  } else if (typeof out.systemCode === "string" && out.systemCode) out.splits = [];
  // Split by usage replaces a fixed system or % split.
  if (out.splitByUsage === 1) {
    out.systemCode = "";
    out.splits = [];
  }
  if ("accountId" in b) {
    if (b.accountId === null || b.accountId === "") out.accountId = null;
    else if (Number.isInteger(Number(b.accountId))) out.accountId = Number(b.accountId);
    else return "Unknown account";
  }
  return out;
}

// Empty, or two or more different systems whose shares add up to 100.
function readSplits(v: unknown): Read<Split[]> {
  if (!Array.isArray(v)) return "Splits must be a list";
  if (v.length === 0) return [];
  if (v.length === 1) return "A shared charge needs two systems or more";
  const out: Split[] = [];
  for (const raw of v) {
    const r = (raw ?? {}) as Body;
    if (!BILLING_SYSTEM_CODES.includes(r.systemCode as string)) return "Unknown system in the split";
    if (out.some((x) => x.systemCode === r.systemCode)) return "A system is in the split twice";
    const n = Number(r.percent);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return "Each share must be more than 0% and at most 100%";
    out.push({ systemCode: r.systemCode as string, percent: Math.round(n * 100) / 100 });
  }
  const total = out.reduce((a, x) => a + x.percent, 0);
  if (Math.abs(total - 100) > 0.001) return `The shares add up to ${Math.round(total * 100) / 100}%, not 100%`;
  return out;
}

function readCard(b: Body, isNew: boolean): Read<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (isNew && !("nickname" in b)) return "Give the card a nickname";
  const errors = [
    text(b, "nickname", out, { required: "Give the card a nickname", max: 60 }),
    ...["bank", "holder", "company", "notes"].map((k) => text(b, k, out)),
  ].filter(Boolean);
  if (errors.length) return errors[0] as string;
  if ("last4" in b) {
    const v = typeof b.last4 === "string" ? b.last4.trim() : "";
    if (!/^(\d{4})?$/.test(v)) return "Last 4 digits: exactly 4 digits, never the full card number";
    out.last4 = v;
  }
  if ("statementDay" in b) {
    if (b.statementDay === null || b.statementDay === "") out.statementDay = null;
    else {
      const n = Number(b.statementDay);
      if (!Number.isInteger(n) || n < 1 || n > 31) return "Statement day: 1 to 31";
      out.statementDay = n;
    }
  }
  return out;
}

type SplitRow = { chargeId: number; systemCode: string; percent: string };
const chargeOut = <T extends { id: number; amount: string | null }>(r: T, splits: SplitRow[]) => ({
  ...r,
  amount: r.amount === null ? null : Number(r.amount),
  splits: splits.filter((s) => s.chargeId === r.id).map((s) => ({ systemCode: s.systemCode, percent: Number(s.percent) })),
});
const stamp = (c: { get(k: "user"): { name: string } }) => ({ updatedAt: nowIso(), updatedBy: c.get("user").name });

// ponytail: whole tables on purpose; bounded by the few dozen services and cards the companies pay for. Paginate if that stops being true.
billing.get("/", need("billing_view", "billing_edit"), async (c) => {
  const db = c.get("db");
  // ponytail: statement lines grow by a few dozen a month; whole table is fine for years. Page by month if that stops being true.
  const [charges, splits, cards, accounts, lines, invoices, invoiceLines, projectRefs, workspaces, usage] = await Promise.all([
    db.select().from(ch).orderBy(asc(ch.registerId), asc(ch.id)),
    db.select().from(sp),
    db.select().from(cd).orderBy(asc(cd.nickname)),
    db.select({ id: schema.accounts.id, name: schema.accounts.name }).from(schema.accounts).orderBy(asc(schema.accounts.name)),
    db.select().from(sl).orderBy(desc(sl.txnDate), desc(sl.id)),
    // ponytail: invoices grow by a dozen or so a month, like statement lines; whole tables for now.
    db.select().from(schema.invoices).orderBy(desc(schema.invoices.invoiceDate), desc(schema.invoices.id)),
    db.select().from(schema.invoiceLines).orderBy(asc(schema.invoiceLines.id)),
    db.select().from(schema.projectRefs).orderBy(asc(schema.projectRefs.ref)),
    db.select().from(schema.vendorWorkspaces).orderBy(asc(schema.vendorWorkspaces.vendor), asc(schema.vendorWorkspaces.name)),
    db
      .select({
        month: sql<string>`substr(${schema.usageCosts.day}, 1, 7)`,
        vendor: schema.usageCosts.vendor,
        workspaceId: schema.usageCosts.workspaceId,
        usd: sql<string>`sum(${schema.usageCosts.usd})`,
      })
      .from(schema.usageCosts)
      .groupBy(sql`1`, schema.usageCosts.vendor, schema.usageCosts.workspaceId),
  ]);
  return c.json({
    charges: charges.map((r) => chargeOut(r, splits)),
    systems: BILLING_SYSTEMS.map(([code, name]) => ({ code, name })),
    cards,
    accounts,
    lines: lines.map(lineOut),
    invoices: invoices.map((r) => ({ ...r, total: Number(r.total) })),
    invoiceLines: invoiceLines.map((r) => ({ ...r, amount: Number(r.amount) })),
    projectRefs,
    workspaces,
    usage: usage.map((u) => ({ ...u, usd: Number(u.usd) })),
    usageSyncedAt: workspaces.reduce<string | null>((a, w) => (a && a > w.updatedAt ? a : w.updatedAt), null),
  });
});

// --- Statement lines -------------------------------------------------------

function readLine(b: Body, isNew: boolean): Read<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (isNew || "txnDate" in b) {
    if (typeof b.txnDate !== "string" || !DATE_RE.test(b.txnDate)) return "Date must be a date";
    out.txnDate = b.txnDate;
  }
  if (isNew || "amountMyr" in b) {
    const n = Number(b.amountMyr);
    // Negative is allowed: refunds show on statements as credits.
    if (b.amountMyr === "" || b.amountMyr === null || !Number.isFinite(n) || Math.abs(n) > 1e9) return "Amount must be a number";
    out.amountMyr = n.toFixed(2);
  }
  if ("checkedByHand" in b) out.checkedByHand = b.checkedByHand ? 1 : 0;
  const errors = ["card", "description", "registerId", "notes"].map((k) => text(b, k, out)).filter(Boolean);
  return errors.length ? (errors[0] as string) : out;
}

const lineOut = <T extends { amountMyr: string }>(r: T) => ({ ...r, amountMyr: Number(r.amountMyr) });

billing.post("/lines", need("billing_edit"), async (c) => {
  const f = readLine((await c.req.json().catch(() => ({}))) as Body, true);
  if (typeof f === "string") return c.json({ error: f }, 400);
  const [row] = await c.get("db")
    .insert(sl)
    .values({ ...(f as object), txnDate: f.txnDate as string, amountMyr: f.amountMyr as string, createdAt: nowIso(), ...stamp(c) })
    .returning();
  return c.json({ line: lineOut(row!) }, 201);
});

// Many lines at once, from a statement pasted on the page. All or nothing.
billing.post("/lines/bulk", need("billing_edit"), async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { lines?: unknown };
  if (!Array.isArray(b.lines) || b.lines.length === 0) return c.json({ error: "No lines to add" }, 400);
  if (b.lines.length > 500) return c.json({ error: "500 lines at most at a time" }, 400);
  const rows = [];
  for (const [i, raw] of b.lines.entries()) {
    const f = readLine((raw ?? {}) as Body, true);
    if (typeof f === "string") return c.json({ error: `Line ${i + 1}: ${f}` }, 400);
    rows.push({ ...(f as object), txnDate: f.txnDate as string, amountMyr: f.amountMyr as string, createdAt: nowIso(), ...stamp(c) });
  }
  const inserted = await c.get("db").insert(sl).values(rows).returning();
  return c.json({ lines: inserted.map(lineOut) }, 201);
});

billing.patch("/lines/:id", need("billing_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Line not found" }, 404);
  const f = readLine((await c.req.json().catch(() => ({}))) as Body, false);
  if (typeof f === "string") return c.json({ error: f }, 400);
  const [row] = await c.get("db").update(sl).set({ ...f, ...stamp(c) }).where(eq(sl.id, id)).returning();
  if (!row) return c.json({ error: "Line not found" }, 404);
  return c.json({ line: lineOut(row) });
});

billing.delete("/lines/:id", need("billing_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Line not found" }, 404);
  const deleted = await c.get("db").delete(sl).where(eq(sl.id, id)).returning({ id: sl.id });
  if (deleted.length === 0) return c.json({ error: "Line not found" }, 404);
  return c.json({ ok: true });
});

// --- Charges ---------------------------------------------------------------

// Replaces a charge's splits when the body gave them, and returns the charge with its splits.
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
async function withSplits(tx: Tx, row: typeof ch.$inferSelect, splits: Split[] | undefined) {
  if (splits) {
    await tx.delete(sp).where(eq(sp.chargeId, row.id));
    if (splits.length) await tx.insert(sp).values(splits.map((s) => ({ chargeId: row.id, systemCode: s.systemCode, percent: s.percent.toFixed(2) })));
  }
  return chargeOut(row, await tx.select().from(sp).where(eq(sp.chargeId, row.id)));
}

billing.post("/charges", need("billing_edit"), async (c) => {
  const f = readCharge((await c.req.json().catch(() => ({}))) as Body, true);
  if (typeof f === "string") return c.json({ error: f }, 400);
  const { splits, ...fields } = f as Record<string, unknown> & { splits?: Split[] };
  const now = nowIso();
  const charge = await c.get("db").transaction(async (tx) => {
    const [row] = await tx
      .insert(ch)
      .values({ ...fields, vendor: fields.vendor as string, createdAt: now, ...stamp(c) })
      .returning();
    return withSplits(tx, row!, splits);
  });
  return c.json({ charge }, 201);
});

billing.patch("/charges/:id", need("billing_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Charge not found" }, 404);
  const f = readCharge((await c.req.json().catch(() => ({}))) as Body, false);
  if (typeof f === "string") return c.json({ error: f }, 400);
  const { splits, ...fields } = f as Record<string, unknown> & { splits?: Split[] };
  const charge = await c.get("db").transaction(async (tx) => {
    const [row] = await tx.update(ch).set({ ...fields, ...stamp(c) }).where(eq(ch.id, id)).returning();
    return row ? withSplits(tx, row, splits) : null;
  });
  if (!charge) return c.json({ error: "Charge not found" }, 404);
  return c.json({ charge });
});

billing.delete("/charges/:id", need("billing_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Charge not found" }, 404);
  const deleted = await c.get("db").delete(ch).where(eq(ch.id, id)).returning({ id: ch.id });
  if (deleted.length === 0) return c.json({ error: "Charge not found" }, 404);
  return c.json({ ok: true });
});

billing.post("/cards", need("billing_edit"), async (c) => {
  const f = readCard((await c.req.json().catch(() => ({}))) as Body, true);
  if (typeof f === "string") return c.json({ error: f }, 400);
  const now = nowIso();
  try {
    const [row] = await c.get("db")
      .insert(cd)
      .values({ ...(f as object), nickname: f.nickname as string, createdAt: now, ...stamp(c) })
      .returning();
    return c.json({ card: row }, 201);
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: "A card with that nickname already exists" }, 409);
    throw e;
  }
});

// Renaming a card renames it on its charges too, so they stay attached.
billing.patch("/cards/:id", need("billing_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Card not found" }, 404);
  const f = readCard((await c.req.json().catch(() => ({}))) as Body, false);
  if (typeof f === "string") return c.json({ error: f }, 400);
  try {
    const row = await c.get("db").transaction(async (tx) => {
      const [old] = await tx.select({ nickname: cd.nickname }).from(cd).where(eq(cd.id, id));
      if (!old) return null;
      const [updated] = await tx.update(cd).set({ ...f, ...stamp(c) }).where(eq(cd.id, id)).returning();
      if (typeof f.nickname === "string" && f.nickname !== old.nickname) {
        await tx.update(ch).set({ card: f.nickname }).where(eq(ch.card, old.nickname));
      }
      return updated;
    });
    if (!row) return c.json({ error: "Card not found" }, 404);
    return c.json({ card: row });
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: "A card with that nickname already exists" }, 409);
    throw e;
  }
});

// Refused while any charge still names the card, so no bill is left pointing at nothing.
billing.delete("/cards/:id", need("billing_edit"), async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Card not found" }, 404);
  const [card] = await db.select({ nickname: cd.nickname }).from(cd).where(eq(cd.id, id));
  if (!card) return c.json({ error: "Card not found" }, 404);
  const [{ n }] = await db.select({ n: count() }).from(ch).where(eq(ch.card, card.nickname));
  if (n > 0) return c.json({ error: `${n} charge(s) still use this card. Move them to another card first.` }, 400);
  await db.delete(cd).where(eq(cd.id, id));
  return c.json({ ok: true });
});

// --- AI usage per system ----------------------------------------------------

// Reads Anthropic's cost per workspace now, instead of waiting for the daily run.
billing.post("/usage/refresh", need("billing_edit"), async (c) => {
  try {
    return c.json(await syncAnthropicCosts(c.env, c.get("db")));
  } catch (e) {
    if (e instanceof UsageSetupError) return c.json({ error: e.message }, 400);
    console.error("[anthropic-usage]", e);
    return c.json({ error: "Could not read Anthropic's cost report. Try again later." }, 502);
  }
});

// Which system a vendor workspace is for. Only updatedBy changes: updatedAt is the time
// the workspace was last read from the vendor (shown as "read ... ago").
billing.patch("/workspaces", need("billing_edit"), async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as Body;
  if (typeof b.vendor !== "string" || typeof b.workspaceId !== "string") return c.json({ error: "Unknown workspace" }, 400);
  if (b.systemCode !== "" && !BILLING_SYSTEM_CODES.includes(b.systemCode as string)) return c.json({ error: "Unknown system" }, 400);
  const w = schema.vendorWorkspaces;
  const [row] = await c.get("db")
    .update(w)
    .set({ systemCode: b.systemCode as string, updatedBy: c.get("user").name })
    .where(and(eq(w.vendor, b.vendor), eq(w.workspaceId, b.workspaceId)))
    .returning();
  if (!row) return c.json({ error: "Unknown workspace" }, 404);
  return c.json({ workspace: row });
});

billing.route("/invoices", invoicesRoute);
billing.route("/refs", refsRoute);

export default billing;
