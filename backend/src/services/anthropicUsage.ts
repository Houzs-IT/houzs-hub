import { and, between, eq, sql } from "drizzle-orm";
import { schema, type DB } from "../db/client";
import { BILLING_SYSTEMS } from "../db/schema";
import type { Env } from "../types";

// Reads the company Anthropic organisation's cost per workspace per day from the Admin
// API cost report, so System billing can split Anthropic credit across the systems by what
// each one used (each system has its own workspace). Read-only on Anthropic's side.
// Runs once a day from the cron and on demand from the Billing page.

const VENDOR = "Anthropic";
const DAYS_BACK = 40; // re-read the last 40 days: costs can settle a day or two late

type Page<T> = { data: T[]; has_more: boolean; next_page?: string | null; last_id?: string | null };
type Workspace = { id: string; name: string };
type CostBucket = { starting_at: string; results: { amount: string; workspace_id: string | null }[] };

export class UsageSetupError extends Error {}

async function get<T>(env: Env, path: string): Promise<T> {
  const base = env.ANTHROPIC_ADMIN_BASE_URL || "https://api.anthropic.com";
  const res = await fetch(base + path, {
    headers: { "x-api-key": env.ANTHROPIC_ADMIN_KEY!, "anthropic-version": "2023-06-01", "User-Agent": "HouzsITHub/1.0" },
  });
  if (res.status === 401 || res.status === 403) throw new UsageSetupError("Anthropic refused the admin key: check ANTHROPIC_ADMIN_KEY on the hub");
  if (!res.ok) throw new Error(`Anthropic ${path.split("?")[0]}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function syncAnthropicCosts(env: Env, db: DB): Promise<{ workspaces: number; days: number }> {
  if (!env.ANTHROPIC_ADMIN_KEY) throw new UsageSetupError("The hub has no Anthropic admin key yet (ANTHROPIC_ADMIN_KEY)");
  const now = new Date().toISOString();

  // Workspaces: names kept fresh; a new one is matched to a system by name (e.g. "Hookka").
  const workspaces: Workspace[] = [];
  for (let after = ""; ; ) {
    const page = await get<Page<Workspace>>(env, `/v1/organizations/workspaces?limit=100${after ? `&after_id=${after}` : ""}`);
    workspaces.push(...page.data);
    if (!page.has_more || !page.last_id) break;
    after = page.last_id;
  }
  const bySystemName = new Map(BILLING_SYSTEMS.map(([code, name]) => [name.toLowerCase(), code as string]));
  const rows = [{ id: "", name: "Default" }, ...workspaces].map((w) => ({
    vendor: VENDOR,
    workspaceId: w.id,
    name: w.name,
    systemCode: bySystemName.get(w.name.toLowerCase()) ?? "",
    updatedAt: now,
    updatedBy: "anthropic sync",
  }));
  await db
    .insert(schema.vendorWorkspaces)
    .values(rows)
    .onConflictDoUpdate({
      target: [schema.vendorWorkspaces.vendor, schema.vendorWorkspaces.workspaceId],
      set: { name: sql`excluded.name`, updatedAt: now },
    });

  // Cost per workspace per day; amounts come in cents as decimal strings.
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - DAYS_BACK);
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  const cents = new Map<string, number>(); // "day|workspace" -> cents
  for (let page = ""; ; ) {
    const res = await get<Page<CostBucket>>(
      env,
      `/v1/organizations/cost_report?starting_at=${start.toISOString()}&ending_at=${end.toISOString()}&group_by[]=workspace_id&bucket_width=1d&limit=31${page ? `&page=${encodeURIComponent(page)}` : ""}`,
    );
    for (const b of res.data) {
      for (const r of b.results) {
        const k = `${b.starting_at.slice(0, 10)}|${r.workspace_id ?? ""}`;
        cents.set(k, (cents.get(k) ?? 0) + Number(r.amount));
      }
    }
    if (!res.has_more || !res.next_page) break;
    page = res.next_page;
  }

  const days = [...cents.entries()].filter(([, c]) => c !== 0).map(([k, c]) => {
    const [day, workspaceId] = k.split("|");
    return { day: day!, vendor: VENDOR, workspaceId: workspaceId!, usd: (c / 100).toFixed(6) };
  });
  // The re-read window is replaced whole, so a corrected or removed cost does not linger.
  await db.transaction(async (tx) => {
    await tx.delete(schema.usageCosts).where(and(eq(schema.usageCosts.vendor, VENDOR), between(schema.usageCosts.day, ymd(start), ymd(end))));
    if (days.length) await tx.insert(schema.usageCosts).values(days);
  });
  return { workspaces: workspaces.length, days: new Set(days.map((d) => d.day)).size };
}
