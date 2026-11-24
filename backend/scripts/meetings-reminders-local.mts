// Local only: runs the meeting reminder cron (sendDueReminders) against the throwaway Postgres, then runs it
// again to show a reminder is queued once. The ERP's Mail Center collects and sends it (POST /mail/claim).
// Usage: npx tsx scripts/meetings-reminders-local.mts   (never against production)
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sendDueReminders } from "../src/services/meetingMail";
const client = postgres("postgres://postgres:postgres@127.0.0.1:54329/postgres", { fetch_types: false });
const db = drizzle(client) as never;
const env = {
  MEETING_MAIL_FROM: "Houzs Meetings <hello@houzscentury.com>",
  MEETING_MAIL_FROM_BY_SYSTEM: '{"HC":"Houzs Meetings <hello@houzscentury.com>","HK":"Hookka Meetings <hello@hookka.com>"}',
  MEETING_ERP_URLS: '{"HC":"https://erp.houzscentury.com","HK":"https://erp.hookka.com"}',
} as never;
(async () => {
  const n = await sendDueReminders(env, db);
  const q = await client`SELECT via, from_addr, to_emails, subject FROM meeting_mail WHERE kind = 'reminder' AND sent_at IS NULL`;
  console.log("reminders", n, "queued", JSON.stringify(q));
  const n2 = await sendDueReminders(env, db);
  console.log("second run reminders", n2);
  await client.end();
})();
