import { asc, eq, lt } from "drizzle-orm";
import { schema, type DB } from "../db/client";
import { nowIso } from "./tickets";

const TIMEOUT_MS = 10_000;
const KEEP_DAYS = 7;

type Result = { ok: number; status: number | null; ms: number | null; version: string | null; error: string | null };

// One request to a system's public health address. Up means a 2xx answer that does
// not itself say { ok: false }; a JSON body's sha or version is kept so a deploy
// shows on the page. Sign-in pages (no health address) only need to open.
async function checkOne(url: string): Promise<Result> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "HouzsHub-HealthCheck/1.0 (https://support.houzscentury.com)", Accept: "application/json, text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    let version: string | null = null;
    let saysDown = false;
    if ((res.headers.get("content-type") ?? "").includes("json")) {
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (body && body.ok === false) saysDown = true;
      const v = body?.sha ?? body?.version ?? body?.build;
      if (typeof v === "string" && v) version = /^[0-9a-f]{40}$/i.test(v) ? v.slice(0, 7) : v.slice(0, 40);
    } else {
      await res.body?.cancel();
    }
    const ok = res.ok && !saysDown;
    return { ok: ok ? 1 : 0, status: res.status, ms, version, error: ok ? null : saysDown ? "Says it is not OK" : `Answered ${res.status}` };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: 0, status: null, ms: null, version: null, error: timedOut ? `No answer in ${TIMEOUT_MS / 1000}s` : "Could not connect" };
  }
}

// Checks every active target once, side by side, and drops results older than a week.
export async function runHealthChecks(db: DB) {
  const t = schema.healthTargets;
  const targets = await db.select({ id: t.id, checkUrl: t.checkUrl }).from(t).where(eq(t.active, 1)).orderBy(asc(t.sort));
  const checkedAt = nowIso();
  const results = await Promise.all(targets.map(async (x) => ({ targetId: x.id, checkedAt, ...(await checkOne(x.checkUrl)) })));
  if (results.length) await db.insert(schema.healthChecks).values(results);
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();
  await db.delete(schema.healthChecks).where(lt(schema.healthChecks.checkedAt, cutoff));
  return results;
}
