// A small Resend sender for the AI Connector's own emails (round 4d: morning brief, alerts,
// group monthly report). The same key and API the health alerts use (services/healthAlerts.ts):
// `wrangler secret put RESEND_API_KEY`. Without the key nothing is sent and the caller says so;
// the cron skips. Meeting emails are different: each ERP's Mail Center sends those.
import type { Env } from "../types";

const MAIL_TIMEOUT_MS = 10_000;
const DEFAULT_FROM = "Houzs IT Hub <no-reply@houzscentury.com>";

export type Mail = { to: string; subject: string; html: string; text: string };
export type MailResult = { sent: true; id: string } | { sent: false; reason: string };

/** Whether email can go out at all (the page shows "not set up" otherwise). */
export const mailConfigured = (env: Env): boolean => !!env.RESEND_API_KEY;

export async function sendMail(env: Env, m: Mail, fetchImpl: typeof fetch = fetch): Promise<MailResult> {
  if (!env.RESEND_API_KEY) return { sent: false, reason: "Email is not set up on the hub (no RESEND_API_KEY)." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.to)) return { sent: false, reason: "No valid email address." };
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.BRIEF_MAIL_FROM || env.HEALTH_ALERT_FROM || DEFAULT_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
    signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
  });
  if (!res.ok) return { sent: false, reason: `Resend answered ${res.status}` };
  const body = (await res.json().catch(() => ({}))) as { id?: unknown };
  return { sent: true, id: typeof body.id === "string" ? body.id : "" };
}
