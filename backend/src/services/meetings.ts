import { sql, type SQL } from "drizzle-orm";
import type { DB } from "../db/client";

// Meeting rooms: the rules every booking passes, wherever it comes from (an ERP page,
// a guest link, a repeat series). One place, so a guest cannot get what staff cannot.
//
// Times: Malaysia has no daylight saving, so "local" is UTC+8 everywhere here.

export const TZ_OFFSET_MS = 8 * 3600_000;
const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 86400_000;

export class MeetingInputError extends Error {}

type Exec = Pick<DB, "execute">;
// getDb turns fetch_types off, so timestamptz columns arrive as text ("2026-11-24 02:00:00+00").
const DATE_COLS = new Set(["starts_at", "ends_at", "started_at", "ended_at", "created_at", "updated_at", "read_at", "at", "synced_at", "sent_at"]);
const pgDate = (v: string) => new Date(v.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
export const rows = async <T>(db: Exec, q: SQL): Promise<T[]> => {
  const rs = (await db.execute(q)) as unknown as Record<string, unknown>[];
  for (const r of rs)
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (typeof v !== "string") continue;
      if (DATE_COLS.has(k)) r[k] = pgDate(v);
      else if (INT_ARRAYS.has(k)) r[k] = pgArray(v).map(Number);
      else if (TEXT_ARRAYS.has(k)) r[k] = pgArray(v);
      else if (k === "guest" || k === "reminders") r[k] = JSON.parse(v);
    }
  return rs as unknown as T[];
};
// Same for arrays: "{1,2}" and {TV,"Video call"}.
const INT_ARRAYS = new Set(["open_days", "room_ids", "days"]);
const TEXT_ARRAYS = new Set(["equipment", "host_keys", "guest_emails", "to_emails"]);
export function pgArray(s: string): string[] {
  const inner = s.replace(/^\{|\}$/g, "");
  if (!inner) return [];
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (q) {
      if (ch === "\\") cur += inner[++i];
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const local = (t: number) => new Date(t + TZ_OFFSET_MS);
export const localDay = (t: number) => local(t).getUTCDay();
export const localHours = (t: number) => local(t).getUTCHours() + local(t).getUTCMinutes() / 60;
/** YYYY-MM-DD of the local calendar day. */
export const localIso = (t: number) => local(t).toISOString().slice(0, 10);
/** Start of the local day containing t, as epoch ms. */
export const localDayStart = (t: number) => Date.parse(`${localIso(t)}T00:00:00+08:00`);
export const atLocal = (iso: string, h: number, m = 0) => Date.parse(`${iso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`);

export type Room = {
  id: number;
  name: string;
  location: string;
  /** Full street address for visitors (emails show it with a map link). */
  address: string;
  floor: string;
  seats: number;
  equipment: string[];
  open_days: number[];
  open_from: number;
  open_to: number;
  color: string;
  buffer_min: number;
  max_hours: number;
  advance_days: number;
  active: boolean;
  closures: { id: number; from: string; to: string; reason: string }[];
};

export type MeetingRow = {
  id: number;
  title: string;
  starts_at: Date;
  ends_at: Date;
  room_id: number | null;
  organizer: string;
  booked_by: string;
  notes: string;
  video_type: string;
  video_url: string;
  reminders: unknown;
  status: string;
  started_at: Date | null;
  ended_at: Date | null;
  series_id: string | null;
  created_in: string;
  link_id: number | null;
  guest: { name: string; phone: string; email: string; company: string } | null;
  guest_emails: string[];
};

export type Busy = { id: number; title: string; start: number; end: number; room_id: number | null; organizer: string; people: string[] };

/** scheduled -> live -> ended by the clock, unless someone pressed Start or End first. */
export function effStatus(m: { status: string; starts_at: Date; ends_at: Date }, now: number): string {
  if (m.status === "cancelled" || m.status === "ended") return m.status;
  if (now >= m.ends_at.getTime()) return "ended";
  if (m.status === "live" || now >= m.starts_at.getTime()) return "live";
  return "scheduled";
}

export function personKey(system: string, externalId: string, email: string | null | undefined): string {
  const e = (email ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(e) ? e : `${system}:${externalId}`;
}

export async function loadRooms(db: Exec, onlyActive = false): Promise<Room[]> {
  const rs = await rows<Omit<Room, "closures">>(
    db,
    sql`SELECT id, name, location, address, floor, seats, equipment, open_days, open_from, open_to, color, buffer_min, max_hours, advance_days, active
        FROM meeting_rooms ${onlyActive ? sql`WHERE active` : sql``} ORDER BY location, name`,
  );
  const cl = await rows<{ id: number; room_id: number; from_date: string | Date; to_date: string | Date; reason: string }>(
    db,
    sql`SELECT id, room_id, from_date::text AS from_date, to_date::text AS to_date, reason FROM meeting_room_closures ORDER BY from_date`,
  );
  return rs.map((r) => ({
    ...r,
    closures: cl.filter((c) => c.room_id === r.id).map((c) => ({ id: c.id, from: String(c.from_date).slice(0, 10), to: String(c.to_date).slice(0, 10), reason: c.reason })),
  }));
}

export function inHours(r: Room, start: number, end: number): boolean {
  return r.open_days.includes(localDay(start)) && localHours(start) >= r.open_from && (localHours(end) || 24) <= r.open_to && localIso(start) === localIso(end - 1);
}

/** Room rules (closed dates, longest booking, how far ahead). Messages are shown to people as they are. */
export function roomRules(r: Room, start: number, end: number, now: number): string[] {
  const out: string[] = [];
  if (!r.active) out.push(`${r.name} is not open for booking.`);
  if (localIso(start) !== localIso(end - 1)) out.push("A booking must start and end on the same day.");
  for (const c of r.closures) {
    const a = atLocal(c.from, 0);
    const b = atLocal(c.to, 0) + DAY;
    if (start < b && a < end) out.push(`${r.name} is closed ${c.from === c.to ? c.from : `${c.from} to ${c.to}`}${c.reason ? ` (${c.reason})` : ""}.`);
  }
  if (r.max_hours && end - start > r.max_hours * HOUR) out.push(`${r.name} can be booked for at most ${r.max_hours} hours at a time.`);
  if (r.advance_days && start > localDayStart(now) + (r.advance_days + 1) * DAY) out.push(`${r.name} can be booked at most ${r.advance_days} days ahead.`);
  return out;
}

/** Live meetings overlapping [from, to), with their people. Cancelled and finished ones never block. */
export async function busyBetween(db: Exec, from: number, to: number, now: number): Promise<Busy[]> {
  const ms = await rows<MeetingRow>(
    db,
    sql`SELECT id, title, starts_at, ends_at, room_id, organizer, status FROM meetings
        WHERE status <> 'cancelled' AND starts_at < ${new Date(to).toISOString()}::timestamptz AND ends_at > ${new Date(from).toISOString()}::timestamptz`,
  );
  const live = ms.filter((m) => effStatus(m, now) !== "ended");
  if (!live.length) return [];
  const att = await rows<{ meeting_id: number; person_key: string }>(
    db,
    sql`SELECT meeting_id, person_key FROM meeting_attendees WHERE meeting_id IN ${live.map((m) => m.id)}`,
  );
  return live.map((m) => ({
    id: m.id,
    title: m.title,
    start: m.starts_at.getTime(),
    end: m.ends_at.getTime(),
    room_id: m.room_id,
    organizer: m.organizer,
    people: [m.organizer, ...att.filter((a) => a.meeting_id === m.id).map((a) => a.person_key)],
  }));
}

export type Draft = { id: number | null; start: number; end: number; roomId: number | null; people: string[] };
export type Conflict = {
  room: { id: number; title: string; start: number; end: number; organizer: string } | null;
  people: { key: string; meeting: { id: number; title: string; start: number; end: number } }[];
  rules: string[];
};

export function conflictsIn(busy: Busy[], rooms: Room[], d: Draft, now: number): Conflict {
  const r = d.roomId ? rooms.find((x) => x.id === d.roomId) ?? null : null;
  const buf = (r?.buffer_min ?? 0) * MIN;
  const others = busy.filter((b) => b.id !== d.id);
  const roomHit = r ? others.find((b) => b.room_id === r.id && b.start < d.end + buf && d.start - buf < b.end) ?? null : null;
  const people: Conflict["people"] = [];
  for (const k of new Set(d.people)) {
    const hit = others.find((b) => b.people.includes(k) && b.start < d.end && d.start < b.end);
    if (hit) people.push({ key: k, meeting: { id: hit.id, title: hit.title, start: hit.start, end: hit.end } });
  }
  return {
    room: roomHit && { id: roomHit.id, title: roomHit.title, start: roomHit.start, end: roomHit.end, organizer: roomHit.organizer },
    people,
    rules: r ? roomRules(r, d.start, d.end, now) : [],
  };
}

/* ---------- who may see what (audit 2026-11-28, B1) ---------- */

type Who = { organizer: string; booked_by: string; room_id: number | null; people: string[] };

/** The organiser or the booker: may change, cancel, start or end the meeting. */
export const mayChangeMeeting = (m: Pick<Who, "organizer" | "booked_by">, actor: string) => m.organizer === actor || m.booked_by === actor;

/** The people IN the meeting — organiser, booker, attendees. The same rule the meeting page uses for adding files. */
export const inMeeting = (m: Pick<Who, "organizer" | "booked_by" | "people">, actor: string) => mayChangeMeeting(m, actor) || m.people.includes(actor);

/**
 * May see the meeting at all. An online meeting (no room) is private to the people in it
 * (owner 2026-11-24); a room booking stays visible to everyone so the room calendar works.
 */
export const maySeeMeeting = (m: Who, actor: string) => m.room_id !== null || inMeeting(m, actor);

/**
 * May read the meeting's CONTENT: its files, notes and history. Only the people in it.
 * Before the 2026-11-28 audit fix this used maySeeMeeting, so the files of any meeting
 * held in a room (an HR or disciplinary meeting included) could be downloaded by anyone
 * in any connected system.
 */
export const mayReadMeetingContent = inMeeting;

/** SQL twin of maySeeMeeting, for list reads (meetings aliased `m`). */
export const meetingVisibleSql = (key: string): SQL =>
  sql`(m.room_id IS NOT NULL OR m.organizer = ${key} OR m.booked_by = ${key} OR EXISTS (SELECT 1 FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.person_key = ${key}))`;

/** SQL twin of inMeeting / mayReadMeetingContent (meetings aliased `m`). */
export const inMeetingSql = (key: string): SQL =>
  sql`(m.organizer = ${key} OR m.booked_by = ${key} OR EXISTS (SELECT 1 FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.person_key = ${key}))`;

/** A meeting as someone outside it sees it on the room calendar: the slot, not its notes. */
export function forViewer<T extends { notes: string | null }>(pub: T, inside: boolean): T {
  return inside ? pub : { ...pub, notes: null };
}

export const hasConflict = (c: Conflict) => Boolean(c.room || c.people.length || c.rules.length);

/** Other rooms that fit everyone and are free then, smallest first. */
export function freeRooms(busy: Busy[], rooms: Room[], d: Draft, now: number, seatsNeeded: number): Room[] {
  return rooms
    .filter((r) => r.active && r.id !== d.roomId && r.seats >= seatsNeeded)
    .filter((r) => !hasConflict(conflictsIn(busy, rooms, { ...d, roomId: r.id, people: [] }, now)))
    .sort((a, b) => a.seats - b.seats);
}

/** The first later time the same day when every person, and the room if one is set, is free. */
export function nextFreeTime(busy: Busy[], rooms: Room[], d: Draft, now: number): number | null {
  const len = d.end - d.start;
  const dayEnd = atLocal(localIso(d.start), 21);
  for (let t = d.start + 15 * MIN; t + len <= dayEnd; t += 15 * MIN) {
    if (t < now) continue;
    if (!hasConflict(conflictsIn(busy, rooms, { ...d, start: t, end: t + len }, now))) return t;
  }
  return null;
}

/** Dates a repeat series lands on: from the first meeting up to and including `untilIso`. */
export function seriesStarts(start: number, repeat: string, untilIso: string | null): number[] {
  if (!repeat || repeat === "none") return [start];
  const until = atLocal(untilIso ?? localIso(start + 56 * DAY), 0) + DAY;
  const out: number[] = [];
  let t = start;
  for (let i = 0; i < 200 && t < until; i++) {
    const dow = localDay(t);
    if (repeat !== "weekdays" || (dow > 0 && dow < 6)) out.push(t);
    t += repeat === "weekly" ? 7 * DAY : repeat === "monthly" ? 28 * DAY : DAY;
  }
  if (out.length > 120) throw new MeetingInputError("A repeat can create at most 120 meetings. Pick an earlier end date.");
  return out;
}

export function fmtTime(t: number): string {
  const d = local(t);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, "0")}${ap}` : `${h}${ap}`;
}
export function fmtDay(t: number): string {
  const d = local(t);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

export async function notify(db: Exec, keys: string[], text: string, meetingId: number | null) {
  const ks = [...new Set(keys.filter(Boolean))];
  for (const k of ks) await db.execute(sql`INSERT INTO meeting_notifications (person_key, meeting_id, text) VALUES (${k}, ${meetingId}, ${text})`);
}

export async function history(db: Exec, meetingId: number, who: string, text: string) {
  await db.execute(sql`INSERT INTO meeting_history (meeting_id, who, text) VALUES (${meetingId}, ${who}, ${text})`);
}

/** Holds the room's row until the transaction ends, so two people saving the same slot at once go one after the other. */
export async function lockRoom(tx: Exec, roomId: number | null) {
  if (roomId) await tx.execute(sql`SELECT id FROM meeting_rooms WHERE id = ${roomId} FOR UPDATE`);
}

/** The advisory-lock keys for the people of a booking: each once, in one fixed order (no deadlock between two bookings). */
export function personLockKeys(people: string[]): string[] {
  return [...new Set(people.filter(Boolean))].sort().map((k) => `hub-meeting-person:${k}`);
}

/**
 * Hold every person of a booking until the transaction ends (audit 2026-11-28, B2).
 * lockRoom serialises two bookings of the same ROOM; nothing serialised two bookings that
 * share a PERSON — an online meeting has no room at all — so both could pass the clash check
 * and both be saved. Taken after lockRoom, always in personLockKeys order.
 */
export async function lockPeople(tx: Exec, people: string[]) {
  for (const k of personLockKeys(people)) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${k}))`);
}

export const toPgIntArray = (xs: number[]) => sql`string_to_array(${xs.map((x) => String(Math.trunc(x))).join(",")}, ',')::int[]`;
export const toPgTextArray = (xs: string[]) => sql`string_to_array(${xs.map((x) => x.replace(/,/g, " ")).join(",")}, ',')::text[]`;
