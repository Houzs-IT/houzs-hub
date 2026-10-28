import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "../db/client";
import { BILLING_SYSTEM_CODES } from "../db/schema";
import { systemForKey } from "../middleware/systemAuth";
import { nowIso } from "../services/tickets";
import type { Env } from "../types";

// POST /api/v1/sys/ai-usage: a system sends its own daily AI cost estimate per company and
// module, with its hub key. Mounted in index.ts ahead of the ticket routes.
//   { "vendor": "Anthropic",
//     "days": [{ "day": "2026-10-27",
//                "rows": [{ "company": "HOUZS", "module": "scan_so", "usd": 1.23, "calls": 40 }] }] }
// Each day sent replaces that day for the sender, so re-sending the last week is safe.
// A company whose code is a billing system (e.g. "2990") is counted for that system; any
// other company is the sender's own.
const sysAiUsage = new Hono<{ Bindings: Env }>();

const MAX_BYTES = 256 * 1024;
const MAX_DAYS = 40;
const MAX_ROWS = 500;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const VENDORS = ["Anthropic"];

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

sysAiUsage.post("/", async (c) => {
  const system = await systemForKey(c);
  if (system instanceof Response) return system;
  if (!BILLING_SYSTEM_CODES.includes(system.code)) return c.json({ error: `System ${system.code} has no billing` }, 400);
  const text = await c.req.text();
  if (text.length > MAX_BYTES) return c.json({ error: "Report too large (256 KB at most)" }, 413);
  let raw: Record<string, unknown> | null;
  try {
    raw = obj(JSON.parse(text));
  } catch {
    return c.json({ error: "Report must be JSON" }, 400);
  }
  if (!raw) return c.json({ error: "Report must be a JSON object" }, 400);
  const vendor = typeof raw.vendor === "string" ? raw.vendor : "";
  if (!VENDORS.includes(vendor)) return c.json({ error: `vendor must be one of: ${VENDORS.join(", ")}` }, 400);
  if (!Array.isArray(raw.days) || raw.days.length > MAX_DAYS) return c.json({ error: `days must be a list of at most ${MAX_DAYS}` }, 400);

  const now = nowIso();
  const days: string[] = [];
  // Rows for the same day, company and module are added together.
  const sums = new Map<string, { day: string; systemCode: string; module: string; usd: number; calls: number }>();
  for (const [i, d0] of raw.days.entries()) {
    const d = obj(d0);
    if (!d || typeof d.day !== "string" || !DAY_RE.test(d.day)) return c.json({ error: `days[${i}]: day must be YYYY-MM-DD` }, 400);
    if (!Array.isArray(d.rows) || d.rows.length > MAX_ROWS) return c.json({ error: `days[${i}]: rows must be a list of at most ${MAX_ROWS}` }, 400);
    days.push(d.day);
    for (const [k, r0] of d.rows.entries()) {
      const r = obj(r0);
      const module = typeof r?.module === "string" ? r.module.trim().slice(0, 60) : "";
      const usd = Number(r?.usd);
      if (!r || !module || !Number.isFinite(usd) || usd < 0 || usd > 1e6) return c.json({ error: `days[${i}].rows[${k}]: needs a module and a usd of 0 or more` }, 400);
      const company = typeof r.company === "string" ? r.company.trim().toUpperCase() : "";
      const systemCode = BILLING_SYSTEM_CODES.includes(company) ? company : system.code;
      const calls = Number.isInteger(r.calls) && (r.calls as number) >= 0 ? (r.calls as number) : 0;
      const key = `${d.day}|${systemCode}|${module}`;
      const s = sums.get(key) ?? { day: d.day, systemCode, module, usd: 0, calls: 0 };
      s.usd += usd;
      s.calls += calls;
      sums.set(key, s);
    }
  }

  const rows = [...sums.values()].map((s) => ({ ...s, vendor, sourceSystem: system.code, usd: s.usd.toFixed(6), receivedAt: now }));
  const mu = schema.moduleUsage;
  await getDb(c.env).transaction(async (tx) => {
    if (days.length) await tx.delete(mu).where(and(eq(mu.vendor, vendor), eq(mu.sourceSystem, system.code), inArray(mu.day, days)));
    for (let i = 0; i < rows.length; i += 1000) await tx.insert(mu).values(rows.slice(i, i + 1000));
  });
  return c.json({ ok: true, days: days.length, rows: rows.length }, 201);
});

export default sysAiUsage;
