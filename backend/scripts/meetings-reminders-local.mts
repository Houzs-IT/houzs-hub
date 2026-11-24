// Local only: runs the meeting reminder cron (sendDueReminders + drainMail) against the throwaway Postgres
// and the stand-in mail server on 127.0.0.1:8796, then runs it again to show nothing is sent twice.
// Usage: npx tsx scripts/meetings-reminders-local.mts   (never against production)
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { drainMail, sendDueReminders } from "../src/services/meetingMail";
const client = postgres("postgres://postgres:postgres@127.0.0.1:54329/postgres", { fetch_types: false });
const db = drizzle(client) as never;
const env = {
  RESEND_API_KEY: "re_local_test_only",
  RESEND_BASE_URL: "http://127.0.0.1:8796",
  MEETING_MAIL_FROM: "Houzs Meetings <no-reply@houzscentury.com>",
  MEETING_MAIL_FROM_BY_SYSTEM: '{"HC":"Houzs Meetings <no-reply@houzscentury.com>","HK":"Hookka Meetings <no-reply@hookka.com>"}',
  MEETING_ERP_URLS: '{"HC":"https://erp.houzscentury.com","HK":"https://erp.hookka.com"}',
} as never;
(async () => { const n = await sendDueReminders(env, db);
const r = await drainMail(env, db);
console.log("reminders", n, "sent", r.sent, "failed", r.failed);
const n2 = await sendDueReminders(env, db);
console.log("second run reminders", n2);
await client.end(); })();
