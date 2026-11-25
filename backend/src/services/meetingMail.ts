// Meeting emails (owner 2026-11-24): invitation, change, cancellation, reminder, guest confirmation and the notice
// to staff that a guest booked. The hub writes them into meeting_mail; the ERP the meeting was made in collects
// them (claimMail) and sends them through its own Mail Center, with its own provider and domain, then reports
// back (reportMail) (owner 2026-11-25). IT Support meetings go out through Houzs. A claim with no report is
// offered again after 10 minutes, at most 5 tries. ERP notices (meeting_notifications) do not depend on any of it.
import { sql } from "drizzle-orm";
import type { DB } from "../db/client";
import type { Env } from "../types";
import { notify, rows } from "./meetings";

type Exec = Pick<DB, "execute">;

export type Person = { key: string; name: string; email: string | null; system: string; company: string; department: string };
export type MailMeeting = {
  id: number;
  /** The ERP it was made in: decides the sender and the brand. */
  system: string;
  title: string;
  start: number;
  end: number;
  organizer: string;
  people: string[];
  notes: string;
  videoType: string;
  videoUrl: string;
  room: { name: string; floor: string; location: string; address: string; seats: number } | null;
  /** Outside guests invited by email. */
  guestEmails: string[];
};
type Rendered = { subject: string; html: string; text: string };
/** via: the ERP whose Mail Center sends it. */
type Mail = Rendered & { from: string; via: string };

const TZ = "Asia/Kuala_Lumpur";
const day = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(t);
const shortDay = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(t);
const time = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The sender for a system: its company's Mail Center address, else the fallback (Houzs). */
export function senderFor(env: Env, system: string): string {
  try {
    const map = JSON.parse(env.MEETING_MAIL_FROM_BY_SYSTEM ?? "{}") as Record<string, string>;
    if (map[system]) return map[system];
  } catch {
    // fall through
  }
  return env.MEETING_MAIL_FROM ?? "";
}
/** "Hookka Meetings <hello@hookka.com>" -> "Hookka Meetings", for the email's header line. */
const brandOf = (from: string) => from.replace(/\s*<[^>]*>\s*$/, "").trim() || "Meetings";

export async function peopleByKey(db: Exec, keys: string[]): Promise<Map<string, Person>> {
  const out = new Map<string, Person>();
  const ks = [...new Set(keys.filter(Boolean))];
  if (!ks.length) return out;
  const r = await rows<{ person_key: string; name: string; email: string | null; system_code: string; company: string; department: string }>(
    db,
    sql`SELECT DISTINCT ON (person_key) person_key, name, email, system_code, company, department FROM meeting_people WHERE person_key IN ${ks} ORDER BY person_key, synced_at DESC`,
  );
  for (const p of r) out.set(p.person_key, { key: p.person_key, name: p.name, email: p.email || (p.person_key.includes("@") ? p.person_key : null), system: p.system_code, company: p.company, department: p.department });
  for (const k of ks) if (!out.has(k)) out.set(k, { key: k, name: k, email: k.includes("@") ? k : null, system: "", company: "", department: "" });
  return out;
}

function erpUrl(env: Env, system: string): string | null {
  try {
    const map = JSON.parse(env.MEETING_ERP_URLS ?? "{}") as Record<string, string>;
    return map[system] ? `${map[system].replace(/\/+$/, "")}/meetings` : null;
  } catch {
    return null;
  }
}

// ---- layout ---------------------------------------------------------------------------------------------------
type Row = [string, string];
function shell(o: { brand: string; bar?: string; kicker?: string; heading: string; rows: Row[]; button?: { label: string; url: string }; under?: string; foot: string }): string {
  const tr = o.rows
    .map(([k, v]) => `<tr><td style="width:96px;color:#5b655f;vertical-align:top;padding:2px 0">${esc(k)}</td><td style="padding:2px 0">${v}</td></tr>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:20px 12px;background:#f2f3f1">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dfe3dc;border-radius:10px;font-family:Arial,Helvetica,sans-serif;color:#1d2420">
<tr><td style="padding:18px 24px;border-bottom:3px solid ${o.bar ?? "#0f5c4c"};font-size:13px;color:#5b655f;letter-spacing:.06em;text-transform:uppercase">${esc(o.brand)}</td></tr>
${o.kicker ? `<tr><td style="padding:22px 24px 0;font-size:13px;color:#0f5c4c;font-weight:bold;text-transform:uppercase;letter-spacing:.05em">${esc(o.kicker)}</td></tr>` : ""}
<tr><td style="padding:${o.kicker ? "4px" : "22px"} 24px 6px;font-size:20px;font-weight:bold;line-height:1.3">${esc(o.heading)}</td></tr>
<tr><td style="padding:6px 24px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.6">${tr}</table></td></tr>
${o.button ? `<tr><td style="padding:0 24px ${o.under ? "8px" : "22px"}"><a href="${esc(o.button.url)}" style="display:inline-block;background:#0f5c4c;color:#ffffff;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:6px;font-size:15px">${esc(o.button.label)}</a></td></tr>` : ""}
${o.under ? `<tr><td style="padding:0 24px 22px;font-size:13px;color:#5b655f">${esc(o.under)}</td></tr>` : ""}
<tr><td style="padding:14px 24px;border-top:1px solid #eceee9;font-size:12px;color:#7a837d">${esc(o.foot)}</td></tr>
</table></body></html>`;
}
const plain = (heading: string, rows: Row[], extra: string[]) =>
  [heading, "", ...rows.map(([k, v]) => `${k}: ${v.replace(/<br>/g, ", ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')}`), "", ...extra].join("\n");

const whenRow = (m: { start: number; end: number }): Row => [
  "When",
  `<b>${esc(day(m.start))}</b><br>${time(m.start)} - ${time(m.end)} (Malaysia time)`,
];
const mapLink = (address: string) =>
  `<br>${esc(address)}<br><a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(address)}" style="color:#0f5c4c">Open in Google Maps</a>`;
function whereRow(m: MailMeeting): Row {
  if (m.room) return ["Where", esc([m.room.name, m.room.floor, m.room.location].filter(Boolean).join(", ")) + (m.room.address ? mapLink(m.room.address) : "")];
  const app = m.videoType === "meet" ? "Google Meet" : m.videoType === "zoom" ? "Zoom" : m.videoUrl ? "Video link" : "No room";
  return ["Where", esc(m.videoUrl ? `Online, ${app}` : app)];
}
const joinButton = (m: MailMeeting, erp: string | null) =>
  !m.room && m.videoUrl
    ? { label: m.videoType === "meet" ? "Join Google Meet" : m.videoType === "zoom" ? "Join Zoom" : "Join the meeting", url: m.videoUrl }
    : erp
      ? { label: "Open in the ERP", url: erp }
      : undefined;

// ---- the six emails -------------------------------------------------------------------------------------------
export function renderInvite(m: MailMeeting, by: string, organizer: Person, people: Person[], erp: string | null, brand: string): Rendered {
  const rows: Row[] = [whenRow(m), whereRow(m), ["Organiser", esc([organizer.name, organizer.company, organizer.department].filter(Boolean).join(", "))]];
  if (people.length) rows.push(["People", esc(people.map((p) => p.name).join(", "))]);
  if (!m.room && m.videoUrl) rows.push(["Link", `<a href="${esc(m.videoUrl)}" style="color:#0f5c4c">${esc(m.videoUrl)}</a>`]);
  if (m.notes) rows.push(["Agenda", esc(m.notes).replace(/\n/g, "<br>")]);
  const heading = `${by} invited you to ${m.title}`;
  const foot = `You are in this meeting, so you will get a reminder before it starts. Questions? Contact ${organizer.name}, the organiser.`;
  return {
    subject: `Invitation: ${m.title}, ${shortDay(m.start)}, ${time(m.start)}`,
    html: shell({ brand, heading, rows, button: erp ? { label: "Open in the ERP", url: erp } : joinButton(m, null), foot }),
    text: plain(heading, rows, [erp ? `Open in the ERP: ${erp}` : "", foot]),
  };
}

export function renderReminder(m: MailMeeting, minutes: number, organizer: Person, erp: string | null, brand: string): Rendered {
  const lead = minutes < 60 ? `${minutes} minutes` : minutes % 1440 === 0 ? `${minutes / 1440} day${minutes === 1440 ? "" : "s"}` : minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`;
  const rows: Row[] = [whenRow(m), whereRow(m), ["Organiser", esc(organizer.name)]];
  const button = joinButton(m, erp);
  const foot = `Sent because you are in this meeting. Cannot make it? Tell ${organizer.name}, the organiser.`;
  return {
    subject: `Starts in ${lead}: ${m.title}, ${time(m.start)}`,
    html: shell({ brand, kicker: `Starts in ${lead}`, heading: m.title, rows, button, under: !m.room && m.videoUrl ? m.videoUrl.replace(/^https:\/\//, "") : undefined, foot }),
    text: plain(`Starts in ${lead}: ${m.title}`, rows, [button ? `${button.label}: ${button.url}` : "", foot]),
  };
}

export function renderChanged(m: MailMeeting, by: string, before: { start: number; end: number }, organizer: Person, erp: string | null, brand: string): Rendered {
  const moved = before.start !== m.start || before.end !== m.end;
  const rows: Row[] = moved
    ? [
        ["Now", `<b>${esc(day(m.start))}, ${time(m.start)} - ${time(m.end)}</b>`],
        ["Was", `<span style="text-decoration:line-through;color:#7a837d">${esc(day(before.start))}, ${time(before.start)} - ${time(before.end)}</span>`],
        whereRow(m),
      ]
    : [whenRow(m), whereRow(m)];
  if (!m.room && m.videoUrl) rows.push(["Link", `<a href="${esc(m.videoUrl)}" style="color:#0f5c4c">${esc(m.videoUrl)}</a>`]);
  const heading = moved ? `${by} moved ${m.title}` : `${by} changed ${m.title}`;
  const foot = `Your reminder moves with it. If this does not work for you, tell ${organizer.name}, the organiser.`;
  return {
    subject: moved ? `Moved: ${m.title} is now ${shortDay(m.start)}, ${time(m.start)}` : `Changed: ${m.title}, ${shortDay(m.start)}, ${time(m.start)}`,
    html: shell({ brand, heading, rows, button: erp ? { label: "Open in the ERP", url: erp } : undefined, foot }),
    text: plain(heading, rows, [erp ? `Open in the ERP: ${erp}` : "", foot]),
  };
}

export function renderCancelled(m: MailMeeting, by: string, brand: string): Rendered {
  const rows: Row[] = [
    ["Was", `<span style="text-decoration:line-through">${esc(day(m.start))}, ${time(m.start)} - ${time(m.end)}</span>`],
    ...(m.room ? ([["Where", `${esc(m.room.name)} is free again`]] as Row[]) : []),
  ];
  const heading = `${by} cancelled ${m.title}`;
  const foot = `Nothing to do. The reminder is cancelled too.`;
  return {
    subject: `Cancelled: ${m.title}, ${shortDay(m.start)}, ${time(m.start)}`,
    html: shell({ brand, bar: "#b42318", heading, rows, foot }),
    text: plain(heading, rows, [foot]),
  };
}

export function renderGuestConfirm(b: { code: string; guestName: string; title: string; people: number; start: number; end: number; room: { name: string; floor: string; location: string; address?: string } }, viewUrl: string | null, company: string): Rendered {
  const rows: Row[] = [
    ["Booking", `<b>${esc(b.code)}</b>`],
    whenRow(b),
    ["Room", esc([b.room.name, b.room.floor, b.room.location].filter(Boolean).join(", ")) + (b.room.address ? mapLink(b.room.address) : "")],
    ["Meeting", esc(`${b.title}, ${b.people} ${b.people === 1 ? "person" : "people"}`)],
  ];
  const heading = `You are booked, ${b.guestName}`;
  const foot = `Need to change the time? Cancel with the button above and book again with the same link.`;
  return {
    subject: `Booked: ${b.room.name}, ${shortDay(b.start)}, ${time(b.start)} (${b.code})`,
    html: shell({ brand: company, heading, rows, button: viewUrl ? { label: "View or cancel your booking", url: viewUrl } : undefined, foot }),
    text: plain(heading, rows, [viewUrl ? `View or cancel your booking: ${viewUrl}` : "", foot]),
  };
}

export function renderGuestNotice(b: { guestName: string; company: string; phone: string; email: string; title: string; people: number; start: number; end: number; roomName: string; linkName: string }, erp: string | null, brand: string): Rendered {
  const rows: Row[] = [
    ["When", `<b>${esc(day(b.start))}, ${time(b.start)} - ${time(b.end)}</b>`],
    ["Room", esc(b.roomName)],
    ["Meeting", esc(`${b.title}, ${b.people} ${b.people === 1 ? "person" : "people"}`)],
    ["Guest", `${esc([b.guestName, b.company].filter(Boolean).join(", "))}<br>${esc([b.phone, b.email].filter(Boolean).join(" · "))}`],
    ["Link", esc(b.linkName)],
  ];
  const heading = `${b.guestName}${b.company ? ` from ${b.company}` : ""} booked a room`;
  const foot = "You can cancel it from the meeting in the ERP; the guest is told.";
  return {
    subject: `Guest booking: ${b.company || b.guestName}, ${b.roomName}, ${shortDay(b.start)}, ${time(b.start)}`,
    html: shell({ brand, heading, rows, button: erp ? { label: "Open in the ERP", url: erp } : undefined, foot }),
    text: plain(heading, rows, [erp ? `Open in the ERP: ${erp}` : "", foot]),
  };
}

// ---- queue and send -------------------------------------------------------------------------------------------
export async function enqueue(db: Exec, meetingId: number | null, kind: string, to: string[], r: Mail): Promise<void> {
  const emails = [...new Set(to.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
  for (const e of emails) {
    await db.execute(sql`INSERT INTO meeting_mail (meeting_id, kind, via, from_addr, to_emails, subject, html, text_body) VALUES (${meetingId}, ${kind}, ${r.via}, ${r.from}, ARRAY[${e}]::text[], ${r.subject}, ${r.html}, ${r.text})`);
  }
}

const CLAIM_BATCH = 20;
const MAX_TRIES = 5;

export type ClaimedMail = { id: number; from: string; to: string[]; subject: string; html: string; text: string };

/** The ERP that sends a system's emails: its own, except IT Support and HRIS, which have no mail of their own and use Houzs. */
export const viaFor = (system: string) => (system === "IT" || system === "HR" || !system ? "HC" : system);

/** Hand a system the emails waiting for it (oldest first) and mark them taken. Each claim counts as a try. */
export async function claimMail(db: Exec, system: string): Promise<ClaimedMail[]> {
  const r = await rows<{ id: number; from_addr: string; to_emails: string[]; subject: string; html: string; text_body: string }>(
    db,
    sql`UPDATE meeting_mail SET claimed_at = now(), attempts = attempts + 1
        WHERE id IN (SELECT id FROM meeting_mail
                     WHERE via = ${system} AND sent_at IS NULL AND attempts < ${MAX_TRIES}
                       AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
                     ORDER BY id LIMIT ${CLAIM_BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING id, from_addr, to_emails, subject, html, text_body`,
  );
  return r.sort((x, y) => x.id - y.id).map((m) => ({ id: Number(m.id), from: m.from_addr, to: m.to_emails, subject: m.subject, html: m.html, text: m.text_body }));
}

/** What the ERP's Mail Center did with each one: sent, or the reason it was not. Only its own claimed rows. */
export async function reportMail(db: Exec, system: string, results: { id: number; error: string | null }[]): Promise<number> {
  let n = 0;
  for (const r of results) {
    const done = r.error
      ? await rows<{ id: number }>(db, sql`UPDATE meeting_mail SET claimed_at = NULL, last_error = ${r.error.slice(0, 300)} WHERE id = ${r.id} AND via = ${system} AND sent_at IS NULL RETURNING id`)
      : await rows<{ id: number }>(db, sql`UPDATE meeting_mail SET sent_at = now(), claimed_at = NULL, last_error = NULL WHERE id = ${r.id} AND via = ${system} AND sent_at IS NULL RETURNING id`);
    n += done.length;
  }
  return n;
}

// ---- reminders ------------------------------------------------------------------------------------------------
type DueRow = { id: number; created_in: string; guest_emails: string[] | null; address: string | null; title: string; starts_at: Date; ends_at: Date; organizer: string; notes: string; video_type: string; video_url: string; reminders: unknown; room_id: number | null; room_name: string | null; floor: string | null; location: string | null; seats: number | null };

export async function loadMailMeeting(db: Exec, id: number): Promise<MailMeeting | null> {
  const [m] = await rows<DueRow>(
    db,
    sql`SELECT m.id, m.created_in, m.guest_emails, m.title, m.starts_at, m.ends_at, m.organizer, m.notes, m.video_type, m.video_url, m.reminders, m.room_id, r.name AS room_name, r.floor, r.location, r.address, r.seats
        FROM meetings m LEFT JOIN meeting_rooms r ON r.id = m.room_id WHERE m.id = ${id}`,
  );
  if (!m) return null;
  return toMail(m, (await rows<{ person_key: string }>(db, sql`SELECT person_key FROM meeting_attendees WHERE meeting_id = ${id}`)).map((a) => a.person_key));
}

function toMail(m: DueRow, attendees: string[]): MailMeeting {
  return {
    id: m.id,
    system: m.created_in,
    title: m.title,
    start: new Date(m.starts_at).getTime(),
    end: new Date(m.ends_at).getTime(),
    organizer: m.organizer,
    people: [m.organizer, ...attendees.filter((a) => a !== m.organizer)],
    notes: m.notes ?? "",
    videoType: m.video_type,
    videoUrl: m.video_url ?? "",
    room: m.room_id && m.room_name ? { name: m.room_name, floor: m.floor ?? "", location: m.location ?? "", address: m.address ?? "", seats: m.seats ?? 0 } : null,
    guestEmails: Array.isArray(m.guest_emails) ? m.guest_emails : [],
  };
}

/** Every reminder now due (start minus its minutes has passed, the meeting has not started): an ERP notice when
 *  "erp" is ticked, an email when "email" is ticked. Recorded per start time, so it goes out once. */
export async function sendDueReminders(env: Env, db: Exec, now = Date.now()): Promise<number> {
  const ms = await rows<DueRow>(
    db,
    sql`SELECT m.id, m.created_in, m.guest_emails, m.title, m.starts_at, m.ends_at, m.organizer, m.notes, m.video_type, m.video_url, m.reminders, m.room_id, r.name AS room_name, r.floor, r.location, r.address, r.seats
        FROM meetings m LEFT JOIN meeting_rooms r ON r.id = m.room_id
        WHERE m.status = 'scheduled' AND m.starts_at > ${new Date(now).toISOString()}::timestamptz AND m.starts_at <= ${new Date(now + 7 * 86400_000).toISOString()}::timestamptz`,
  );
  let n = 0;
  for (const row of ms) {
    const rems = (Array.isArray(row.reminders) ? row.reminders : []) as { min?: number; ch?: string[] }[];
    const start = new Date(row.starts_at).getTime();
    for (const r of rems) {
      const min = Number(r.min);
      if (!Number.isFinite(min) || now < start - min * 60_000) continue;
      const claimed = await rows<{ meeting_id: number }>(
        db,
        sql`INSERT INTO meeting_reminders_sent (meeting_id, minutes, starts_at) VALUES (${row.id}, ${min}, ${new Date(row.starts_at).toISOString()}::timestamptz) ON CONFLICT DO NOTHING RETURNING meeting_id`,
      );
      if (!claimed.length) continue;
      const attendees = (await rows<{ person_key: string }>(db, sql`SELECT person_key FROM meeting_attendees WHERE meeting_id = ${row.id}`)).map((a) => a.person_key);
      const m = toMail(row, attendees);
      const ch = r.ch ?? ["erp"];
      if (ch.includes("erp")) await notify(db, m.people, `Starts at ${time(m.start)}: ${m.title}${m.room ? ` in ${m.room.name}` : m.videoUrl ? `, ${m.videoUrl}` : ""}.`, m.id);
      if (ch.includes("email")) {
        const ppl = await peopleByKey(db, m.people);
        const org = ppl.get(m.organizer)!;
        for (const p of ppl.values()) if (p.email) await enqueue(db, m.id, "reminder", [p.email], withFrom(env, m.system, (b) => renderReminder(m, min, org, erpUrl(env, p.system), b)));
        if (m.guestEmails.length) await enqueue(db, m.id, "reminder", m.guestEmails, withFrom(env, m.system, (b) => renderReminder(m, min, org, null, b)));
      }
      n++;
    }
  }
  return n;
}

// ---- events from the routes -----------------------------------------------------------------------------------
/** Invitation to `to` (person keys), each with a button to their own ERP. */
export async function mailInvites(env: Env, db: Exec, meetingId: number, to: string[], byKey: string, guests: string[]): Promise<void> {
  const m = await loadMailMeeting(db, meetingId);
  if (!m || (!to.length && !guests.length)) return;
  const ppl = await peopleByKey(db, [...m.people, byKey, ...to]);
  const others = (k: string) => m.people.filter((x) => x !== k && x !== m.organizer).map((x) => ppl.get(x)!).filter(Boolean);
  for (const k of to) {
    const p = ppl.get(k);
    if (p?.email) await enqueue(db, m.id, "invite", [p.email], withFrom(env, m.system, (b) => renderInvite(m, ppl.get(byKey)?.name ?? byKey, ppl.get(m.organizer)!, others(k), erpUrl(env, p.system), b)));
  }
  if (guests.length) await enqueue(db, m.id, "invite", guests, withFrom(env, m.system, (b) => renderInvite(m, ppl.get(byKey)?.name ?? byKey, ppl.get(m.organizer)!, others(""), null, b)));
}

export async function mailChanged(env: Env, db: Exec, meetingId: number, to: string[], byKey: string, before: { start: number; end: number }, guests: string[]): Promise<void> {
  const m = await loadMailMeeting(db, meetingId);
  if (!m || (!to.length && !guests.length)) return;
  const ppl = await peopleByKey(db, [...m.people, byKey, ...to]);
  for (const k of to) {
    const p = ppl.get(k);
    if (p?.email) await enqueue(db, m.id, "changed", [p.email], withFrom(env, m.system, (b) => renderChanged(m, ppl.get(byKey)?.name ?? byKey, before, ppl.get(m.organizer)!, erpUrl(env, p.system), b)));
  }
  if (guests.length) await enqueue(db, m.id, "changed", guests, withFrom(env, m.system, (b) => renderChanged(m, ppl.get(byKey)?.name ?? byKey, before, ppl.get(m.organizer)!, null, b)));
}

export async function mailCancelled(env: Env, db: Exec, meetingId: number, to: string[], byName: string, guestEmail: string | null, guests: string[]): Promise<void> {
  const m = await loadMailMeeting(db, meetingId);
  if (!m) return;
  const ppl = await peopleByKey(db, to);
  const emails = [...[...ppl.values()].map((p) => p.email).filter((e): e is string => Boolean(e)), ...(guestEmail ? [guestEmail] : []), ...guests];
  await enqueue(db, m.id, "cancelled", emails, withFrom(env, m.system, (b) => renderCancelled(m, byName, b)));
}

/** Render with the brand of the system's sender, and remember that sender. */
export function withFrom(env: Env, system: string, render: (brand: string) => Rendered): Mail {
  const from = senderFor(env, system);
  return { ...render(brandOf(from)), from, via: viaFor(system) };
}

export { erpUrl };
