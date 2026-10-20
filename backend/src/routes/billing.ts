import { asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { schema } from "../db/client";
import { CHARGE_BILLED, CHARGE_STATUSES, CURRENCIES } from "../db/schema";
import { need } from "../middleware/devAuth";
import { nowIso } from "../services/tickets";
import type { DevApp } from "../types";
import { isUniqueViolation } from "./admin";

// The Billing page: charges (the sheet's Register) and company cards (its Cards tab).
// Totals are worked out on the page. Mounted inside routes/dev.ts, after devAuth.
const billing = new Hono<DevApp>();
const ch = schema.charges;
const cd = schema.cards;

const MAX_TEXT = 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Body = Record<string, unknown>;
type Read<T> = T | string;

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
    ...["registerId", "company", "system", "serviceType", "usedFor", "plan", "card", "keyName", "notes"].map((k) => text(b, k, out)),
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
    if (!CHARGE_BILLED.includes(b.billed as (typeof CHARGE_BILLED)[number])) return "Billed: monthly, yearly or blank";
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
  if ("accountId" in b) {
    if (b.accountId === null || b.accountId === "") out.accountId = null;
    else if (Number.isInteger(Number(b.accountId))) out.accountId = Number(b.accountId);
    else return "Unknown account";
  }
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

const chargeOut = <T extends { amount: string | null }>(r: T) => ({ ...r, amount: r.amount === null ? null : Number(r.amount) });
const stamp = (c: { get(k: "user"): { name: string } }) => ({ updatedAt: nowIso(), updatedBy: c.get("user").name });

// ponytail: whole tables on purpose; bounded by the few dozen services and cards the companies pay for. Paginate if that stops being true.
billing.get("/", need("billing_view", "billing_edit"), async (c) => {
  const db = c.get("db");
  const [charges, cards, accounts] = await Promise.all([
    db.select().from(ch).orderBy(asc(ch.registerId), asc(ch.id)),
    db.select().from(cd).orderBy(asc(cd.nickname)),
    db.select({ id: schema.accounts.id, name: schema.accounts.name }).from(schema.accounts).orderBy(asc(schema.accounts.name)),
  ]);
  return c.json({ charges: charges.map(chargeOut), cards, accounts });
});

billing.post("/charges", need("billing_edit"), async (c) => {
  const f = readCharge((await c.req.json().catch(() => ({}))) as Body, true);
  if (typeof f === "string") return c.json({ error: f }, 400);
  const now = nowIso();
  const [row] = await c.get("db")
    .insert(ch)
    .values({ ...(f as object), vendor: f.vendor as string, createdAt: now, ...stamp(c) })
    .returning();
  return c.json({ charge: chargeOut(row!) }, 201);
});

billing.patch("/charges/:id", need("billing_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Charge not found" }, 404);
  const f = readCharge((await c.req.json().catch(() => ({}))) as Body, false);
  if (typeof f === "string") return c.json({ error: f }, 400);
  const [row] = await c.get("db").update(ch).set({ ...f, ...stamp(c) }).where(eq(ch.id, id)).returning();
  if (!row) return c.json({ error: "Charge not found" }, 404);
  return c.json({ charge: chargeOut(row) });
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

export default billing;
