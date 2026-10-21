import { asc, desc, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import { schema } from "../db/client";
import { need } from "../middleware/devAuth";
import { runHealthChecks } from "../services/health";
import { nowIso } from "../services/tickets";
import type { DevApp } from "../types";

// The System health page. The checks themselves run every 5 minutes from the
// scheduled handler in index.ts; this serves the results and edits what is checked.
const health = new Hono<DevApp>();
const t = schema.healthTargets;
const h = schema.healthChecks;

const HTTPS = /^https:\/\/[^\s]+$/;

function readTarget(b: Record<string, unknown>, isNew: boolean): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  if (isNew || "name" in b) {
    const v = typeof b.name === "string" ? b.name.trim() : "";
    if (!v || v.length > 80) return "Give the system a name (80 characters at most)";
    out.name = v;
  }
  if (isNew || "checkUrl" in b) {
    const v = typeof b.checkUrl === "string" ? b.checkUrl.trim() : "";
    if (!HTTPS.test(v) || v.length > 500) return "Check address must start with https://";
    out.checkUrl = v;
  }
  if ("pageUrl" in b) {
    const v = typeof b.pageUrl === "string" ? b.pageUrl.trim() : "";
    if (v && (!HTTPS.test(v) || v.length > 500)) return "Health page address must start with https://, or be empty";
    out.pageUrl = v;
  }
  if ("systemCode" in b) out.systemCode = typeof b.systemCode === "string" && b.systemCode ? b.systemCode : null;
  if ("sort" in b) {
    const n = Number(b.sort);
    if (!Number.isInteger(n) || n < 0 || n > 999) return "Order must be a whole number";
    out.sort = n;
  }
  if ("active" in b) out.active = b.active ? 1 : 0;
  return out;
}

// Targets with their last 24 hours of results (288 checks each at most).
// ponytail: whole tables on purpose; a handful of systems. Paginate if that stops being true.
health.get("/", need("health_view", "health_edit"), async (c) => {
  const db = c.get("db");
  const since = new Date(Date.now() - 86400_000).toISOString();
  const r = schema.healthReports;
  const [targets, checks, systems, latest, history] = await Promise.all([
    db.select().from(t).orderBy(asc(t.sort), asc(t.id)),
    db
      .select({ targetId: h.targetId, checkedAt: h.checkedAt, ok: h.ok, status: h.status, ms: h.ms, version: h.version, error: h.error })
      .from(h)
      .where(gte(h.checkedAt, since))
      .orderBy(desc(h.checkedAt)),
    db.select({ code: schema.systems.code, name: schema.systems.name }).from(schema.systems).orderBy(asc(schema.systems.name)),
    // The newest report of each system that has ever sent one.
    db
      .selectDistinctOn([r.systemCode], { systemCode: r.systemCode, receivedAt: r.receivedAt, ok: r.ok, report: r.report })
      .from(r)
      .orderBy(r.systemCode, desc(r.receivedAt)),
    db.select({ systemCode: r.systemCode, receivedAt: r.receivedAt, ok: r.ok }).from(r).where(gte(r.receivedAt, since)).orderBy(desc(r.receivedAt)),
  ]);
  return c.json({ targets, checks, systems, reports: { latest, history } });
});

health.post("/check-now", need("health_edit"), async (c) => {
  await runHealthChecks(c.get("db"));
  return c.json({ ok: true });
});

const stamp = (name: string) => ({ updatedAt: nowIso(), updatedBy: name });

health.post("/targets", need("health_edit"), async (c) => {
  const f = readTarget((await c.req.json().catch(() => ({}))) as Record<string, unknown>, true);
  if (typeof f === "string") return c.json({ error: f }, 400);
  const [row] = await c.get("db")
    .insert(t)
    .values({ ...(f as object), name: f.name as string, checkUrl: f.checkUrl as string, createdAt: nowIso(), ...stamp(c.get("user").name) })
    .returning();
  return c.json({ target: row }, 201);
});

health.patch("/targets/:id", need("health_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "System not found" }, 404);
  const f = readTarget((await c.req.json().catch(() => ({}))) as Record<string, unknown>, false);
  if (typeof f === "string") return c.json({ error: f }, 400);
  const [row] = await c.get("db").update(t).set({ ...f, ...stamp(c.get("user").name) }).where(eq(t.id, id)).returning();
  if (!row) return c.json({ error: "System not found" }, 404);
  return c.json({ target: row });
});

// Its results go with it (ON DELETE CASCADE); they exist only to describe this target.
health.delete("/targets/:id", need("health_edit"), async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "System not found" }, 404);
  const deleted = await c.get("db").delete(t).where(eq(t.id, id)).returning({ id: t.id });
  if (deleted.length === 0) return c.json({ error: "System not found" }, 404);
  return c.json({ ok: true });
});

export default health;
