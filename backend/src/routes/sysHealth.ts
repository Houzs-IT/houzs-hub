import { and, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "../db/client";
import type { HealthReport, HealthStatus } from "../db/schema";
import { systemForKey } from "../middleware/systemAuth";
import { nowIso } from "../services/tickets";
import type { Env } from "../types";

// POST /api/v1/sys/health: a system sends its own health report with its hub key.
// No person is involved, so unlike the ticket routes there is no X-Reporter-Id.
// Mounted in index.ts ahead of the ticket routes. The report is cut down to the
// shape the System health page draws, so a system cannot store anything else here.
const sysHealth = new Hono<{ Bindings: Env }>();

const MAX_BYTES = 64 * 1024;
const KEEP_DAYS = 7;
const STATUSES: HealthStatus[] = ["ok", "warning", "critical", "off"];

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function clean(raw: Record<string, unknown>): HealthReport {
  const db = obj(raw.db);
  // The Conts and Hookka call file storage "r2"; either name is accepted.
  const st = obj(raw.storage) ?? obj(raw.r2);
  const counts: Record<string, number | string | null> = {};
  for (const [k, v] of Object.entries(obj(raw.counts) ?? {}).slice(0, 40)) {
    counts[str(k, 60)] = typeof v === "number" && Number.isFinite(v) ? v : v == null ? null : str(v, 80);
  }
  const checks = (Array.isArray(raw.checks) ? raw.checks : []).slice(0, 40).flatMap((x) => {
    const c = obj(x);
    if (!c) return [];
    const status = STATUSES.includes(c.status as HealthStatus) ? (c.status as HealthStatus) : "warning";
    const detail = str(c.detail, 400);
    return [{ key: str(c.key, 60), label: str(c.label, 80), value: str(c.value, 40), status, summary: str(c.summary, 200), ...(detail ? { detail } : {}) }];
  });
  const problems = (Array.isArray(raw.problems) ? raw.problems : []).slice(0, 30).flatMap((x) => {
    const p = obj(x);
    return p ? [{ at: str(p.at, 40), what: str(p.what, 200), where: p.where ? str(p.where, 120) : null, error: p.error ? str(p.error, 300) : null }] : [];
  });
  return {
    ok: raw.ok === true,
    time: typeof raw.time === "string" ? raw.time.slice(0, 40) : null,
    db: db ? { ok: db.ok === true, latency_ms: num(db.latency_ms), ...(db.error ? { error: str(db.error, 200) } : {}) } : null,
    storage: st ? { bound: st.bound !== false, ok: st.ok === true, latency_ms: num(st.latency_ms) } : null,
    counts,
    checks,
    problems,
  };
}

sysHealth.post("/", async (c) => {
  const system = await systemForKey(c);
  if (system instanceof Response) return system;
  const text = await c.req.text();
  if (text.length > MAX_BYTES) return c.json({ error: "Report too large (64 KB at most)" }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return c.json({ error: "Report must be JSON" }, 400);
  }
  if (!obj(raw)) return c.json({ error: "Report must be a JSON object" }, 400);

  const report = clean(raw as Record<string, unknown>);
  const db = getDb(c.env);
  await db.insert(schema.healthReports).values({ systemCode: system.code, receivedAt: nowIso(), ok: report.ok ? 1 : 0, report });
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();
  await db.delete(schema.healthReports).where(and(eq(schema.healthReports.systemCode, system.code), lt(schema.healthReports.receivedAt, cutoff)));
  return c.json({ ok: true }, 201);
});

export default sysHealth;
