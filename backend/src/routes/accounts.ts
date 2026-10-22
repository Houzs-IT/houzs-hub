import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { schema } from "../db/client";
import { ACCOUNT_STATUSES, type AccountStatus } from "../db/schema";
import { need } from "../middleware/devAuth";
import { nowIso } from "../services/tickets";
import type { DevApp } from "../types";

// The Accounts page: outside accounts and who controls them. Mounted inside
// routes/dev.ts, after devAuth. Reading needs either permission; every change needs accounts_edit.
const accounts = new Hono<DevApp>();
const a = schema.accounts;

const TEXT_FIELDS = ["companies", "vendor", "mainOwner", "control", "itAccess", "billsTo", "registerIds", "nextStep"] as const;
const MAX_TEXT = 1000;

type Fields = Partial<Record<(typeof TEXT_FIELDS)[number] | "name", string>> & { status?: AccountStatus };

// Only the fields present in the body are returned, so PATCH changes just those.
function readFields(b: Record<string, unknown>, isNew: boolean): Fields | string {
  const out: Fields = {};
  if (isNew || "name" in b) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) return "Give the account a name";
    if (name.length > 200) return "Name: 200 characters at most";
    out.name = name;
  }
  for (const k of TEXT_FIELDS) {
    if (!(k in b)) continue;
    if (typeof b[k] !== "string") return `${k} must be text`;
    const v = (b[k] as string).trim();
    if (v.length > MAX_TEXT) return `${k}: ${MAX_TEXT} characters at most`;
    out[k] = v;
  }
  if ("status" in b) {
    if (!ACCOUNT_STATUSES.includes(b.status as AccountStatus)) return "Unknown status";
    out.status = b.status as AccountStatus;
  }
  return out;
}

// ponytail: whole table on purpose; bounded by the few dozen outside services the companies use. Paginate if that stops being true.
accounts.get("/", need("accounts_view", "accounts_edit"), async (c) => {
  const rows = await c.get("db").select().from(a).orderBy(asc(a.id));
  return c.json({ accounts: rows });
});

accounts.post("/", need("accounts_edit"), async (c) => {
  const f = readFields((await c.req.json().catch(() => ({}))) as Record<string, unknown>, true);
  if (typeof f === "string") return c.json({ error: f }, 400);
  const now = nowIso();
  const [row] = await c.get("db")
    .insert(a)
    .values({ ...f, name: f.name!, createdAt: now, updatedAt: now, updatedBy: c.get("user").name })
    .returning();
  return c.json({ account: row }, 201);
});

accounts.patch("/:id", need("accounts_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Account not found" }, 404);
  const f = readFields((await c.req.json().catch(() => ({}))) as Record<string, unknown>, false);
  if (typeof f === "string") return c.json({ error: f }, 400);
  const [row] = await c.get("db")
    .update(a)
    .set({ ...f, updatedAt: nowIso(), updatedBy: c.get("user").name })
    .where(eq(a.id, id))
    .returning();
  if (!row) return c.json({ error: "Account not found" }, 404);
  return c.json({ account: row });
});

accounts.delete("/:id", need("accounts_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Account not found" }, 404);
  const deleted = await c.get("db").delete(a).where(eq(a.id, id)).returning({ id: a.id });
  if (deleted.length === 0) return c.json({ error: "Account not found" }, 404);
  return c.json({ ok: true });
});

export default accounts;
