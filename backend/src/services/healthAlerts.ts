import { asc, desc, gte, inArray } from "drizzle-orm";
import { schema, type DB } from "../db/client";
import type { HealthReport } from "../db/schema";
import type { Env } from "../types";

const STALE_MS = 15 * 60_000; // the same as the System health page
const RECENT_CHECKS_MS = 30 * 60_000;
const MAIL_TIMEOUT_MS = 10_000;
const HEALTH_PAGE = "https://support.houzscentury.com/health";

export type Problem = { key: string; system: string; what: string };
type Check = { targetId: number; ok: number; error: string | null };
type Target = { id: number; name: string; systemCode: string | null; active: number };
type Report = { systemCode: string; receivedAt: string; report: HealthReport };
type OpenAlert = typeof schema.healthAlerts.$inferSelect;

// What is wrong right now. Checks are newest first: a system counts as down after two
// failed checks in a row, so one slow answer sends no email. Only red cards count, not
// warnings. A report that stopped keeps its red cards, so silence never reads as fixed.
export function findProblems(targets: Target[], checks: Check[], reports: Report[], names: Map<string, string>, nowMs: number): Problem[] {
  const out: Problem[] = [];
  for (const t of targets) {
    if (!t.active) continue;
    const [a, b] = checks.filter((c) => c.targetId === t.id);
    if (a && b && !a.ok && !b.ok) out.push({ key: `target:${t.id}`, system: t.name, what: `Down: ${a.error ?? "failed its check"}` });
  }
  for (const { systemCode, receivedAt, report } of reports) {
    // A system whose checks were all paused on the page is paused here too.
    const own = targets.filter((t) => t.systemCode === systemCode);
    if (own.length && !own.some((t) => t.active)) continue;
    const system = names.get(systemCode) ?? systemCode;
    const add = (part: string, what: string) => out.push({ key: `report:${systemCode}:${part}`, system, what });
    if (nowMs - Date.parse(receivedAt) > STALE_MS) add("stale", "Stopped sending its health report");
    if (report.db && !report.db.ok) add("db", `Database: ${report.db.error ?? "did not answer"}`);
    if (report.storage?.bound && !report.storage.ok) add("storage", "File storage did not answer");
    for (const c of report.checks) {
      if (c.status === "critical") add(`check:${c.key}`, `${c.label}: ${c.summary}`);
    }
  }
  return out;
}

// Compares what is wrong now with what is already open. An alert whose email failed
// stays unsent and goes out on the next run; one fixed before any email goes quietly.
export function alertChanges(open: OpenAlert[], problems: Problem[], at: string) {
  const openKeys = new Set(open.map((r) => r.key));
  const nowKeys = new Set(problems.map((p) => p.key));
  const fresh: OpenAlert[] = problems.filter((p) => !openKeys.has(p.key)).map((p) => ({ ...p, since: at, emailedAt: null }));
  const gone = open.filter((r) => !nowKeys.has(r.key));
  return {
    fresh,
    started: [...open.filter((r) => !r.emailedAt && nowKeys.has(r.key)), ...fresh],
    fixed: gone.filter((r) => r.emailedAt),
    dropped: gone.filter((r) => !r.emailedAt),
  };
}

export function alertEmail(started: OpenAlert[], fixed: OpenAlert[], nowMs: number) {
  const line = (r: OpenAlert) => `- ${r.system}: ${r.what}`;
  const fixedLine = (r: OpenAlert) => `${line(r)} (${Math.max(1, Math.round((nowMs - Date.parse(r.since)) / 60_000))} min)`;
  const first = started[0] ?? fixed[0]!;
  const more = started.length ? started.length - 1 : fixed.length - 1;
  const subject = `${started.length ? "Problem" : "Fixed"}: ${first.system}${more ? ` and ${more} more` : ""}`;
  const parts = [
    started.length ? `New problems:\n${started.map(line).join("\n")}` : "",
    fixed.length ? `Fixed:\n${fixed.map(fixedLine).join("\n")}` : "",
    `System health: ${HEALTH_PAGE}`,
  ];
  return { subject, text: parts.filter(Boolean).join("\n\n") };
}

async function readProblems(db: DB, nowMs: number) {
  const r = schema.healthReports;
  const h = schema.healthChecks;
  const [targets, checks, reports, systems] = await Promise.all([
    db.select().from(schema.healthTargets),
    db
      .select({ targetId: h.targetId, ok: h.ok, error: h.error })
      .from(h)
      .where(gte(h.checkedAt, new Date(nowMs - RECENT_CHECKS_MS).toISOString()))
      .orderBy(desc(h.checkedAt)),
    db
      .selectDistinctOn([r.systemCode], { systemCode: r.systemCode, receivedAt: r.receivedAt, report: r.report })
      .from(r)
      .orderBy(asc(r.systemCode), desc(r.receivedAt)),
    db.select({ code: schema.systems.code, name: schema.systems.name }).from(schema.systems),
  ]);
  return findProblems(targets, checks, reports, new Map(systems.map((s) => [s.code, s.name])), nowMs);
}

// Runs after the health checks. One email per run at most, listing what started and what
// was fixed. Without the mail key nothing is recorded, so setting it up later starts clean.
export async function sendHealthAlerts(env: Env, db: DB, nowMs = Date.now()) {
  const { RESEND_API_KEY: key, HEALTH_ALERT_TO: to, HEALTH_ALERT_FROM: from } = env;
  if (!key || !to || !from) return;

  const a = schema.healthAlerts;
  const at = new Date(nowMs).toISOString();
  const { fresh, started, fixed, dropped } = alertChanges(await db.select().from(a), await readProblems(db, nowMs), at);
  if (fresh.length) await db.insert(a).values(fresh).onConflictDoNothing();
  if (dropped.length) await db.delete(a).where(inArray(a.key, dropped.map((r) => r.key)));
  if (!started.length && !fixed.length) return;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], ...alertEmail(started, fixed, nowMs) }),
    signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}`);

  if (started.length) await db.update(a).set({ emailedAt: at }).where(inArray(a.key, started.map((r) => r.key)));
  if (fixed.length) await db.delete(a).where(inArray(a.key, fixed.map((r) => r.key)));
}
