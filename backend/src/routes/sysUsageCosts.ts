import { and, eq, inArray, like } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "../db/client";
import { BILLING_SYSTEM_CODES } from "../db/schema";
import { systemForKey } from "../middleware/systemAuth";
import { nowIso } from "../services/tickets";
import type { Env } from "../types";

// POST /api/v1/sys/usage-costs: a system sends a vendor's real cost per company for whole
// months, with its hub key. Houzs Connect sends Meta's WhatsApp charges per company:
//   { "vendor": "Meta (WhatsApp Business)", "currency": "MYR",
//     "months": [{ "month": "2026-11",
//                  "rows": [{ "id": "<company id>", "name": "Hookka", "code": null, "cost": 47.1 }] }] }
// Each company is a vendor workspace "<sender>:<id>", so IT picks its system once on the
// Overview; a code that is a billing system (e.g. "2990") is picked for them. Each month sent
// replaces that month for the sender, so re-sending this month every day is safe.
const sysUsageCosts = new Hono<{ Bindings: Env }>();

const MAX_BYTES = 64 * 1024;
const MAX_MONTHS = 13;
const MAX_ROWS = 100;
const MONTH_RE = /^\d{4}-\d{2}$/;
const VENDORS = ["Meta (WhatsApp Business)"];
const CURRENCIES = ["MYR", "USD"];

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

sysUsageCosts.post("/", async (c) => {
  const system = await systemForKey(c);
  if (system instanceof Response) return system;
  const text = await c.req.text();
  if (text.length > MAX_BYTES) return c.json({ error: "Report too large (64 KB at most)" }, 413);
  let raw: Record<string, unknown> | null;
  try {
    raw = obj(JSON.parse(text));
  } catch {
    return c.json({ error: "Report must be JSON" }, 400);
  }
  if (!raw) return c.json({ error: "Report must be a JSON object" }, 400);
  const vendor = str(raw.vendor, 80);
  if (!VENDORS.includes(vendor)) return c.json({ error: `vendor must be one of: ${VENDORS.join(", ")}` }, 400);
  const currency = str(raw.currency, 3).toUpperCase();
  if (!CURRENCIES.includes(currency)) return c.json({ error: `currency must be one of: ${CURRENCIES.join(", ")}` }, 400);
  if (!Array.isArray(raw.months) || raw.months.length > MAX_MONTHS) return c.json({ error: `months must be a list of at most ${MAX_MONTHS}` }, 400);

  const prefix = `${system.code}:`;
  const now = nowIso();
  const days: string[] = [];
  const workspaces = new Map<string, { name: string; systemCode: string }>();
  const costs = new Map<string, { day: string; workspaceId: string; usd: number }>();
  for (const [i, m0] of raw.months.entries()) {
    const m = obj(m0);
    if (!m || typeof m.month !== "string" || !MONTH_RE.test(m.month)) return c.json({ error: `months[${i}]: month must be YYYY-MM` }, 400);
    if (!Array.isArray(m.rows) || m.rows.length > MAX_ROWS) return c.json({ error: `months[${i}]: rows must be a list of at most ${MAX_ROWS}` }, 400);
    // A month is kept on its first day: usage is only ever read by month.
    const day = `${m.month}-01`;
    days.push(day);
    for (const [k, r0] of m.rows.entries()) {
      const r = obj(r0);
      const id = str(r?.id, 80);
      const cost = Number(r?.cost);
      if (!r || !id || !Number.isFinite(cost) || cost < 0 || cost > 1e7) return c.json({ error: `months[${i}].rows[${k}]: needs an id and a cost of 0 or more` }, 400);
      const workspaceId = prefix + id;
      const code = str(r.code, 20).toUpperCase();
      workspaces.set(workspaceId, { name: str(r.name, 120) || id, systemCode: BILLING_SYSTEM_CODES.includes(code) ? code : "" });
      const key = `${day}|${workspaceId}`;
      costs.set(key, { day, workspaceId, usd: (costs.get(key)?.usd ?? 0) + cost });
    }
  }

  const uc = schema.usageCosts;
  const vw = schema.vendorWorkspaces;
  await getDb(c.env).transaction(async (tx) => {
    for (const [workspaceId, w] of workspaces) {
      // The system IT picked is kept; only a new workspace takes the guess.
      await tx
        .insert(vw)
        .values({ vendor, workspaceId, name: w.name, systemCode: w.systemCode, updatedAt: now })
        .onConflictDoUpdate({ target: [vw.vendor, vw.workspaceId], set: { name: w.name, updatedAt: now } });
    }
    if (days.length) await tx.delete(uc).where(and(eq(uc.vendor, vendor), like(uc.workspaceId, `${prefix}%`), inArray(uc.day, days)));
    const rows = [...costs.values()].map((r) => ({ ...r, vendor, currency, usd: r.usd.toFixed(6) }));
    if (rows.length) await tx.insert(uc).values(rows);
  });
  return c.json({ ok: true, months: days.length, rows: costs.size }, 201);
});

export default sysUsageCosts;
