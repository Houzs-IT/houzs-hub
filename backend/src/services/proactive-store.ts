// Storage for AI Connector round 4d (morning brief + urgent alerts). Pure logic: proactive.ts.
// Tables: migration 026_mcp_proactive_group_report.sql (applied on deploy by db:migrate).
import type { McpDb } from "./mcp-db";
import { randomToken } from "./mcp-store";
import { subscriptionFromRow, type Subscription } from "./proactive";

type Db = McpDb;
type Row = Record<string, unknown>;

/** The OAuth client row the brief's short-lived tokens are issued under (hidden from the connected-apps lists). */
export const BRIEF_CLIENT_ID = "mcpc_morning_brief";

export async function ensureBriefClient(db: Db): Promise<void> {
  await db
    .prepare("INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, 'Morning brief', '[]', ?) ON CONFLICT (client_id) DO NOTHING")
    .bind(BRIEF_CLIENT_ID, new Date().toISOString())
    .run();
}

export async function getSubscription(db: Db, userId: number): Promise<Subscription | null> {
  const r = await db.prepare("SELECT * FROM mcp_brief_subscriptions WHERE user_id = ?").bind(userId).first<Row>();
  return r ? subscriptionFromRow(r) : null;
}

/** Upsert; the unsubscribe token is made once and kept. */
export async function saveSubscription(db: Db, s: Subscription): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO mcp_brief_subscriptions (user_id, brief_enabled, brief_time, brief_days, alerts_enabled, unsub_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET brief_enabled = EXCLUDED.brief_enabled, brief_time = EXCLUDED.brief_time,
         brief_days = EXCLUDED.brief_days, alerts_enabled = EXCLUDED.alerts_enabled, updated_at = EXCLUDED.updated_at`,
    )
    .bind(s.userId, s.briefEnabled ? 1 : 0, s.briefTime, s.briefDays, s.alertsEnabled ? 1 : 0, randomToken(24), now, now)
    .run();
}

export async function unsubscribeToken(db: Db, userId: number): Promise<string> {
  const r = await db.prepare("SELECT unsub_token FROM mcp_brief_subscriptions WHERE user_id = ?").bind(userId).first<Row>();
  return r ? String(r.unsub_token ?? "") : "";
}

/** Turns both emails off for the token's person; their user id, or null for an unknown token. */
export async function unsubscribeWithToken(db: Db, token: string): Promise<number | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const r = await db
    .prepare("UPDATE mcp_brief_subscriptions SET brief_enabled = 0, alerts_enabled = 0, updated_at = ? WHERE unsub_token = ? RETURNING user_id")
    .bind(new Date().toISOString(), token)
    .first<Row>();
  return r ? Number(r.user_id) : null;
}

export type Subscriber = Subscription & { lastAlertCheckAt: string; name: string; email: string };

/** Everyone with either email on and an active account with an email address. */
export async function activeSubscribers(db: Db): Promise<Subscriber[]> {
  const r = await db
    .prepare(
      `SELECT s.*, u.name, u.email FROM mcp_brief_subscriptions s JOIN users u ON u.id = s.user_id
        WHERE (s.brief_enabled = 1 OR s.alerts_enabled = 1) AND u.active = 1 AND u.email IS NOT NULL AND u.email <> ''
        ORDER BY s.user_id`,
    )
    .all<Row>();
  return r.results.map((x) => ({
    ...subscriptionFromRow(x),
    lastAlertCheckAt: x.last_alert_check_at instanceof Date ? x.last_alert_check_at.toISOString() : String(x.last_alert_check_at ?? ""),
    name: String(x.name ?? ""),
    email: String(x.email ?? "").trim(),
  }));
}

export async function markAlertChecked(db: Db, userId: number): Promise<void> {
  await db.prepare("UPDATE mcp_brief_subscriptions SET last_alert_check_at = ? WHERE user_id = ?").bind(new Date().toISOString(), userId).run();
}

/** Claim keys for this person and day; returns the keys this call won (the rest were already claimed). */
export async function claimKeys(db: Db, userId: number, keys: string[], day: string): Promise<string[]> {
  const won: string[] = [];
  for (const k of keys) {
    const r = await db
      .prepare("INSERT INTO mcp_proactive_keys (user_id, alert_key, day, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING alert_key")
      .bind(userId, k.slice(0, 200), day, new Date().toISOString())
      .first<Row>();
    if (r) won.push(k);
  }
  return won;
}

export async function releaseKey(db: Db, userId: number, key: string, day: string): Promise<void> {
  await db.prepare("DELETE FROM mcp_proactive_keys WHERE user_id = ? AND alert_key = ? AND day = ?").bind(userId, key, day).run();
}

export async function keysSentToday(db: Db, userId: number, day: string): Promise<Set<string>> {
  const r = await db.prepare("SELECT alert_key FROM mcp_proactive_keys WHERE user_id = ? AND day = ?").bind(userId, day).all<Row>();
  return new Set(r.results.map((x) => String(x.alert_key)));
}

export async function usersWithKey(db: Db, key: string, day: string): Promise<Set<number>> {
  const r = await db.prepare("SELECT user_id FROM mcp_proactive_keys WHERE alert_key = ? AND day = ?").bind(key, day).all<Row>();
  return new Set(r.results.map((x) => Number(x.user_id)));
}

/** Old ledger rows are not needed after a week. */
export async function pruneKeys(db: Db, beforeDay: string): Promise<void> {
  await db.prepare("DELETE FROM mcp_proactive_keys WHERE day < ?").bind(beforeDay).run();
}

export async function logSend(db: Db, x: { userId: number; kind: string; day: string; items: number; status: string; note: string }): Promise<void> {
  try {
    await db
      .prepare("INSERT INTO mcp_proactive_sends (id, user_id, kind, day, items, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(`mps_${randomToken(12)}`, x.userId, x.kind, x.day, x.items, x.status, x.note.slice(0, 300), new Date().toISOString())
      .run();
  } catch (e) {
    console.warn("[proactive] send log failed:", e instanceof Error ? e.message : String(e));
  }
}

export async function recentSends(db: Db, userId: number, limit = 10) {
  const r = await db.prepare("SELECT kind, day, items, status, note, created_at FROM mcp_proactive_sends WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").bind(userId, limit).all<Row>();
  return r.results.map((x) => ({
    kind: String(x.kind),
    day: String(x.day),
    items: Number(x.items ?? 0),
    status: String(x.status),
    note: String(x.note ?? ""),
    at: x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at ?? ""),
  }));
}
