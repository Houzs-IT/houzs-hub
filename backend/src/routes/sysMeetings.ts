import { sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { getDb, type DB } from "../db/client";
import { systemAuth } from "../middleware/systemAuth";
import {
  MeetingInputError,
  atLocal,
  busyBetween,
  conflictsIn,
  effStatus,
  fmtDay,
  fmtTime,
  freeRooms,
  hasConflict,
  history,
  inHours,
  loadRooms,
  localDay,
  localIso,
  lockRoom,
  nextFreeTime,
  notify,
  personKey,
  rows,
  seriesStarts,
  toPgIntArray,
  toPgTextArray,
  type Draft,
  type MeetingRow,
} from "../services/meetings";
import type { SysApp } from "../types";
import { createMeetLink, GoogleMeetError, meetConfigured } from "../services/googleMeet";

// /api/v1/sys/meetings — meeting rooms for every ERP.
//
// The calling ERP vouches for the person, as it does for IT requests: X-Reporter-Id is
// the user's id in that ERP, and X-Person-Name / -Email / -Company / -Department describe
// them (refreshing the directory on every call). X-Can-Manage-Rooms: 1 means that ERP
// granted the user "Manage meeting rooms". Guest pages are proxied by the ERP with
// X-Reporter-Id: guest and may only use /public/*.

// The routes themselves, with no sign-in of their own: sysMeetings below puts the ERP key check in front,
// and portalMeetings.ts puts the IT Support session in front.
const app = new Hono<SysApp>();

type C = Context<SysApp>;
const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 86400_000;
const MAX_FILE = 25 * 1024 * 1024;
const VIDEO = new Set(["none", "meet", "zoom", "link"]);
const REPEAT = new Set(["none", "daily", "weekdays", "weekly", "monthly"]);
const CHANNELS = new Set(["erp", "email", "wa"]);

app.onError((err, c) => {
  if (err instanceof MeetingInputError) return c.json({ error: err.message }, 400);
  throw err;
});

const hdr = (c: C, name: string, max = 200) => (c.req.header(name) ?? "").trim().slice(0, max);
const canManage = (c: C) => hdr(c, "X-Can-Manage-Rooms") === "1";
const isoOk = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const tOk = (v: unknown) => (typeof v === "string" || typeof v === "number") && Number.isFinite(new Date(v).getTime());
const iso = (t: number) => new Date(t).toISOString();

/** The signed-in person's key, with their directory row refreshed from the ERP's headers. */
async function me(c: C, db: DB): Promise<string> {
  const system = c.get("systemCode");
  const ext = c.get("reporterId");
  if (ext === "guest" || ext === "system") throw new MeetingInputError("This call needs a signed-in person.");
  const name = hdr(c, "X-Person-Name") || `User ${ext}`;
  const email = hdr(c, "X-Person-Email") || null;
  const key = personKey(system, ext, email);
  await db.execute(sql`INSERT INTO meeting_people (system_code, external_id, person_key, name, email, company, department, active, synced_at)
    VALUES (${system}, ${ext}, ${key}, ${name}, ${email}, ${hdr(c, "X-Person-Company")}, ${hdr(c, "X-Person-Department")}, true, now())
    ON CONFLICT (system_code, external_id) DO UPDATE SET person_key = EXCLUDED.person_key, name = EXCLUDED.name, email = EXCLUDED.email,
      company = CASE WHEN EXCLUDED.company <> '' THEN EXCLUDED.company ELSE meeting_people.company END,
      department = CASE WHEN EXCLUDED.department <> '' THEN EXCLUDED.department ELSE meeting_people.department END,
      active = true, synced_at = now()`);
  return key;
}

type Person = { key: string; name: string; email: string | null; company: string; department: string };
async function directory(db: DB): Promise<Person[]> {
  // One person can come from several systems; the newest row wins for their details.
  return rows<Person>(
    db,
    sql`SELECT DISTINCT ON (person_key) person_key AS key, name, email, company, department
        FROM meeting_people WHERE active ORDER BY person_key, synced_at DESC`,
  );
}

function publicMeeting(m: MeetingRow & { people?: string[] }, now: number) {
  return {
    id: m.id,
    title: m.title,
    start: m.starts_at.toISOString(),
    end: m.ends_at.toISOString(),
    roomId: m.room_id,
    organizer: m.organizer,
    bookedBy: m.booked_by,
    attendees: (m.people ?? []).filter((p) => p !== m.organizer),
    notes: m.notes,
    video: { type: m.video_type, url: m.video_url },
    reminders: m.reminders,
    status: effStatus(m, now),
    startedAt: m.started_at?.toISOString() ?? null,
    endedAt: m.ended_at?.toISOString() ?? null,
    seriesId: m.series_id,
    createdIn: m.created_in,
    linkId: m.link_id,
    guest: m.guest,
  };
}

async function withPeople(db: DB, ms: MeetingRow[]) {
  if (!ms.length) return [] as (MeetingRow & { people: string[] })[];
  const att = await rows<{ meeting_id: number; person_key: string }>(db, sql`SELECT meeting_id, person_key FROM meeting_attendees WHERE meeting_id IN ${ms.map((m) => m.id)}`);
  return ms.map((m) => ({ ...m, people: att.filter((a) => a.meeting_id === m.id).map((a) => a.person_key) }));
}

const MEETING_COLS = sql`id, title, starts_at, ends_at, room_id, organizer, booked_by, notes, video_type, video_url, reminders, status, started_at, ended_at, series_id, created_in, link_id, guest`;

async function getMeeting(db: DB, id: number) {
  const [m] = await rows<MeetingRow>(db, sql`SELECT ${MEETING_COLS} FROM meetings WHERE id = ${id} AND status <> 'cancelled'`);
  if (!m) return null;
  return (await withPeople(db, [m]))[0];
}

/** What a person sent for a meeting, checked. Times are ISO strings or epoch ms. */
function readDraft(body: Record<string, unknown>) {
  const title = String(body.title ?? "").trim().slice(0, 200) || "(No title)";
  if (!tOk(body.start) || !tOk(body.end)) throw new MeetingInputError("Pick a start and end time.");
  const start = new Date(body.start as string).getTime();
  const end = new Date(body.end as string).getTime();
  if (end <= start) throw new MeetingInputError("The meeting must end after it starts.");
  if (end - start > 24 * HOUR) throw new MeetingInputError("A meeting can be at most one day long.");
  const roomId = body.roomId == null || body.roomId === "" ? null : Number(body.roomId);
  if (roomId !== null && !Number.isInteger(roomId)) throw new MeetingInputError("Unknown room.");
  const attendees = Array.isArray(body.attendees) ? [...new Set(body.attendees.map(String).map((s) => s.trim()).filter(Boolean))].slice(0, 200) : [];
  const videoType = VIDEO.has(String(body.videoType)) ? String(body.videoType) : "none";
  const videoUrl = String(body.videoUrl ?? "").trim().slice(0, 500);
  if (videoUrl && !/^https:\/\//i.test(videoUrl)) throw new MeetingInputError("A video link must start with https://");
  const reminders = (Array.isArray(body.reminders) ? body.reminders : [])
    .slice(0, 5)
    .map((r) => ({
      min: Math.max(5, Math.min(10080, Math.trunc(Number((r as { min?: unknown }).min) || 15))),
      ch: (Array.isArray((r as { ch?: unknown }).ch) ? ((r as { ch: unknown[] }).ch.map(String) as string[]) : ["erp"]).filter((x) => CHANNELS.has(x)),
    }));
  return { title, start, end, roomId, attendees, videoType, videoUrl, notes: String(body.notes ?? "").slice(0, 5000), reminders };
}

async function conflictReply(c: C, db: DB, d: Draft, now: number) {
  const rooms = await loadRooms(db);
  const busy = await busyBetween(db, d.start - DAY, d.end + DAY, now);
  const conflict = conflictsIn(busy, rooms, d, now);
  if (!hasConflict(conflict)) return null;
  const t = nextFreeTime(busy, rooms, d, now);
  return c.json(
    {
      error: "conflict",
      conflict,
      suggestTime: t === null ? null : iso(t),
      suggestRooms: freeRooms(busy, rooms, d, now, d.people.length).slice(0, 3).map((r) => ({ id: r.id, name: r.name, seats: r.seats, floor: r.floor, equipment: r.equipment })),
    },
    409,
  );
}

/* ---------- the person and the directory ---------- */

app.get("/bootstrap", async (c) => {
  const db = getDb(c.env);
  const key = await me(c, db);
  const [rooms, people, unread] = await Promise.all([
    loadRooms(db),
    directory(db),
    rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM meeting_notifications WHERE person_key = ${key} AND read_at IS NULL`),
  ]);
  return c.json({ me: key, canManage: canManage(c), rooms, people, unread: unread[0]?.n ?? 0, meetConnected: meetConfigured(c.env) });
});

// A new Google Meet link for the booking window (owner 2026-11-24). Staff only: guests never reach it.
app.post("/meet-link", async (c) => {
  const db = getDb(c.env);
  await me(c, db);
  if (!meetConfigured(c.env)) return c.json({ error: "Google Meet is not connected yet. Paste a link instead." }, 409);
  try {
    return c.json({ url: await createMeetLink(c.env) });
  } catch (e) {
    return c.json({ error: e instanceof GoogleMeetError ? e.message : "Google Meet did not answer. Try again, or paste a link." }, 502);
  }
});

// The ERP's whole staff list, so people can invite colleagues from any company before
// those colleagues ever open the Meetings page. People left out are switched off.
app.put("/directory", async (c) => {
  const system = c.get("systemCode");
  const body = (await c.req.json().catch(() => ({}))) as { people?: unknown };
  if (!Array.isArray(body.people) || body.people.length > 5000) return c.json({ error: "Send people: [...] (at most 5000)." }, 400);
  const db = getDb(c.env);
  const seen: string[] = [];
  for (const p of body.people as Record<string, unknown>[]) {
    const ext = String(p.id ?? "").trim();
    const name = String(p.name ?? "").trim().slice(0, 120);
    if (!ext || !name) continue;
    const email = String(p.email ?? "").trim().slice(0, 200) || null;
    const active = p.active !== false;
    seen.push(ext);
    await db.execute(sql`INSERT INTO meeting_people (system_code, external_id, person_key, name, email, company, department, active, synced_at)
      VALUES (${system}, ${ext}, ${personKey(system, ext, email)}, ${name}, ${email}, ${String(p.company ?? "").slice(0, 120)}, ${String(p.department ?? "").slice(0, 120)}, ${active}, now())
      ON CONFLICT (system_code, external_id) DO UPDATE SET person_key = EXCLUDED.person_key, name = EXCLUDED.name, email = EXCLUDED.email,
        company = EXCLUDED.company, department = EXCLUDED.department, active = EXCLUDED.active, synced_at = now()`);
  }
  const off = seen.length
    ? await rows<{ n: number }>(db, sql`WITH u AS (UPDATE meeting_people SET active = false WHERE system_code = ${system} AND active AND external_id NOT IN ${seen} RETURNING 1) SELECT count(*)::int AS n FROM u`)
    : [{ n: 0 }];
  return c.json({ ok: true, received: seen.length, switchedOff: off[0]?.n ?? 0 });
});

/* ---------- calendar and meetings ---------- */

app.get("/calendar", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!tOk(from) || !tOk(to)) return c.json({ error: "from and to are required" }, 400);
  const a = new Date(from!).getTime();
  const b = new Date(to!).getTime();
  if (b <= a || b - a > 62 * DAY) return c.json({ error: "Ask for at most 62 days at a time." }, 400);
  const db = getDb(c.env);
  const key = await me(c, db);
  const ms = await rows<MeetingRow>(
    db,
    sql`SELECT ${MEETING_COLS} FROM meetings m WHERE status <> 'cancelled' AND starts_at < ${iso(b)}::timestamptz AND ends_at > ${iso(a)}::timestamptz AND ${visibleTo(key)} ORDER BY starts_at LIMIT 3000`,
  );
  const now = Date.now();
  return c.json({ meetings: (await withPeople(db, ms)).map((m) => publicMeeting(m, now)) });
});

app.get("/meetings/:id{[0-9]+}", async (c) => {
  const db = getDb(c.env);
  const actor = await me(c, db);
  const m = await getMeeting(db, Number(c.req.param("id")));
  if (!m || !maySee(m, actor)) return c.json({ error: "That meeting is not there any more." }, 404);
  const [hist, files] = await Promise.all([
    rows<{ at: Date; who: string; text: string }>(db, sql`SELECT at, who, text FROM meeting_history WHERE meeting_id = ${m.id} ORDER BY at`),
    rows<{ id: number; file_name: string; size_bytes: number; mime_type: string }>(db, sql`SELECT id, file_name, size_bytes, mime_type FROM meeting_files WHERE meeting_id = ${m.id} ORDER BY id`),
  ]);
  return c.json({ meeting: publicMeeting(m, Date.now()), history: hist.map((h) => ({ at: h.at.toISOString(), who: h.who, text: h.text })), files });
});

app.post("/meetings", async (c) => {
  const db = getDb(c.env);
  const actor = await me(c, db);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const d = readDraft(body);
  const organizer = typeof body.organizer === "string" && body.organizer.trim() ? body.organizer.trim() : actor;
  const repeat = REPEAT.has(String(body.repeat)) ? String(body.repeat) : "none";
  const starts = seriesStarts(d.start, repeat, isoOk(body.repeatUntil) ? body.repeatUntil : null);
  const len = d.end - d.start;
  const now = Date.now();
  const people = [organizer, ...d.attendees.filter((a) => a !== organizer)];
  const seriesId = starts.length > 1 ? crypto.randomUUID() : null;

  // The first meeting must be clear; later ones in a series that clash are skipped and counted.
  const blocked = await conflictReply(c, db, { id: null, start: d.start, end: d.end, roomId: d.roomId, people }, now);
  if (blocked) return blocked;

  const result = await db.transaction(async (tx) => {
    await lockRoom(tx, d.roomId);
    const rooms = await loadRooms(tx);
    const busy = await busyBetween(tx, d.start - DAY, starts[starts.length - 1] + len + DAY, now);
    const ids: number[] = [];
    let skipped = 0;
    for (const s of starts) {
      const draft: Draft = { id: null, start: s, end: s + len, roomId: d.roomId, people };
      if (hasConflict(conflictsIn(busy, rooms, draft, now))) {
        if (s === d.start) return { clash: true as const };
        skipped++;
        continue;
      }
      const [row] = await rows<{ id: number }>(
        tx,
        sql`INSERT INTO meetings (title, starts_at, ends_at, room_id, organizer, booked_by, notes, video_type, video_url, reminders, series_id, created_in)
            VALUES (${d.title}, ${iso(s)}::timestamptz, ${iso(s + len)}::timestamptz, ${d.roomId}, ${organizer}, ${actor}, ${d.notes}, ${d.videoType}, ${d.videoUrl},
                    ${JSON.stringify(d.reminders)}::jsonb, ${seriesId}, ${c.get("systemCode")}) RETURNING id`,
      );
      for (const a of d.attendees.filter((x) => x !== organizer)) await tx.execute(sql`INSERT INTO meeting_attendees (meeting_id, person_key) VALUES (${row.id}, ${a}) ON CONFLICT DO NOTHING`);
      await history(tx, row.id, actor, organizer === actor ? "booked it" : `booked it for ${organizer}`);
      busy.push({ id: row.id, title: d.title, start: s, end: s + len, room_id: d.roomId, organizer, people });
      ids.push(row.id);
    }
    const room = rooms.find((r) => r.id === d.roomId);
    const when = `${fmtDay(d.start)} ${fmtTime(d.start)}${room ? ` in ${room.name}` : ""}`;
    await notify(tx, people.filter((p) => p !== actor), `${await nameOf(tx, actor)} invited you to ${d.title}, ${when}${ids.length > 1 ? ` (repeats, ${ids.length} meetings)` : ""}.`, ids[0]);
    return { ids, skipped };
  });
  if ("clash" in result) return (await conflictReply(c, db, { id: null, start: d.start, end: d.end, roomId: d.roomId, people }, now))!;
  return c.json({ ok: true, ids: result.ids, created: result.ids.length, skipped: result.skipped }, 201);
});

async function nameOf(db: Pick<DB, "execute">, key: string): Promise<string> {
  const [p] = await rows<{ name: string }>(db, sql`SELECT name FROM meeting_people WHERE person_key = ${key} ORDER BY synced_at DESC LIMIT 1`);
  return p?.name ?? key;
}

const mayChange = (m: MeetingRow, actor: string) => m.organizer === actor || m.booked_by === actor;
/** An online meeting (no room) is private to the people in it (owner 2026-11-24); a room booking stays visible to everyone. */
const maySee = (m: MeetingRow & { people: string[] }, actor: string) => m.room_id !== null || mayChange(m, actor) || m.people.includes(actor);
/** SQL twin of maySee for list reads. */
const visibleTo = (key: string) =>
  sql`(m.room_id IS NOT NULL OR m.organizer = ${key} OR m.booked_by = ${key} OR EXISTS (SELECT 1 FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.person_key = ${key}))`;

app.patch("/meetings/:id{[0-9]+}", async (c) => {
  const db = getDb(c.env);
  const actor = await me(c, db);
  const m = await getMeeting(db, Number(c.req.param("id")));
  if (!m) return c.json({ error: "That meeting is not there any more." }, 404);
  if (!mayChange(m, actor)) return c.json({ error: "Only the organiser can change this meeting." }, 403);
  const now = Date.now();
  if (effStatus(m, now) === "ended") return c.json({ error: "This meeting has ended." }, 409);
  if (m.guest && m.link_id) return c.json({ error: "A guest booking is changed by the guest, or cancelled." }, 409);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const d = readDraft({ ...publicMeeting(m, now), roomId: m.room_id, videoType: m.video_type, videoUrl: m.video_url, attendees: m.people, ...body });
  const scope = body.scope === "following" && m.series_id ? "following" : "one";
  const people = [m.organizer, ...d.attendees.filter((a) => a !== m.organizer)];

  const blocked = await conflictReply(c, db, { id: m.id, start: d.start, end: d.end, roomId: d.roomId, people }, now);
  if (blocked) return blocked;

  const dS = d.start - m.starts_at.getTime();
  const dE = d.end - m.ends_at.getTime();
  const targets =
    scope === "following"
      ? await rows<MeetingRow>(db, sql`SELECT ${MEETING_COLS} FROM meetings WHERE series_id = ${m.series_id} AND status <> 'cancelled' AND starts_at >= ${m.starts_at.toISOString()}::timestamptz ORDER BY starts_at`)
      : [m];

  const out = await db.transaction(async (tx) => {
    await lockRoom(tx, d.roomId);
    const rooms = await loadRooms(tx);
    const last = targets[targets.length - 1];
    const busy = await busyBetween(tx, d.start - DAY, last.ends_at.getTime() + dE + DAY, now);
    let changed = 0;
    let skipped = 0;
    for (const t of targets) {
      const s = t.starts_at.getTime() + dS;
      const e = t.ends_at.getTime() + dE;
      if (hasConflict(conflictsIn(busy, rooms, { id: t.id, start: s, end: e, roomId: d.roomId, people }, now))) {
        if (t.id === m.id) return { clash: true as const };
        skipped++;
        continue;
      }
      await tx.execute(sql`UPDATE meetings SET title = ${d.title}, starts_at = ${iso(s)}::timestamptz, ends_at = ${iso(e)}::timestamptz, room_id = ${d.roomId},
        notes = ${d.notes}, video_type = ${d.videoType}, video_url = ${d.videoUrl}, reminders = ${JSON.stringify(d.reminders)}::jsonb, updated_at = now() WHERE id = ${t.id}`);
      await tx.execute(sql`DELETE FROM meeting_attendees WHERE meeting_id = ${t.id}`);
      for (const a of d.attendees.filter((x) => x !== m.organizer)) await tx.execute(sql`INSERT INTO meeting_attendees (meeting_id, person_key) VALUES (${t.id}, ${a}) ON CONFLICT DO NOTHING`);
      const b = busy.find((x) => x.id === t.id);
      if (b) Object.assign(b, { start: s, end: e, room_id: d.roomId, people });
      changed++;
    }
    const rName = rooms.find((r) => r.id === d.roomId)?.name;
    const moved = dS !== 0 || dE !== 0;
    const roomChanged = d.roomId !== m.room_id;
    const what = moved ? `moved it to ${fmtDay(d.start)} ${fmtTime(d.start)} - ${fmtTime(d.end)}` : roomChanged ? `changed the room to ${rName ?? "no room"}` : d.videoUrl !== m.video_url && d.videoUrl ? "added a video link" : "changed the details";
    await history(tx, m.id, actor, scope === "following" ? `${what} (this and following)` : what);
    const actorName = await nameOf(tx, actor);
    const before = [m.organizer, ...m.people];
    const added = people.filter((p) => !before.includes(p));
    const removed = before.filter((p) => !people.includes(p));
    const stay = people.filter((p) => !added.includes(p) && p !== actor);
    const when = `${fmtDay(d.start)} ${fmtTime(d.start)}${rName ? ` in ${rName}` : ""}`;
    await notify(tx, added.filter((p) => p !== actor), `${actorName} invited you to ${d.title}, ${when}.`, m.id);
    await notify(tx, removed.filter((p) => p !== actor), `${actorName} removed you from ${m.title}.`, m.id);
    await notify(tx, stay, moved || roomChanged ? `${actorName} moved ${d.title} to ${when}.` : d.videoUrl !== m.video_url && d.videoUrl ? `${actorName} added a video link to ${d.title}: ${d.videoUrl}` : `${actorName} updated ${d.title} (${when}).`, m.id);
    return { changed, skipped };
  });
  if ("clash" in out) return (await conflictReply(c, db, { id: m.id, start: d.start, end: d.end, roomId: d.roomId, people }, now))!;
  return c.json({ ok: true, ...out });
});

app.post("/meetings/:id{[0-9]+}/cancel", async (c) => {
  const db = getDb(c.env);
  const actor = await me(c, db);
  const m = await getMeeting(db, Number(c.req.param("id")));
  if (!m) return c.json({ error: "That meeting is not there any more." }, 404);
  if (!mayChange(m, actor)) return c.json({ error: "Only the organiser can cancel this meeting." }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { scope?: string };
  const ids =
    body.scope === "following" && m.series_id
      ? (await rows<{ id: number }>(db, sql`SELECT id FROM meetings WHERE series_id = ${m.series_id} AND status <> 'cancelled' AND starts_at >= ${m.starts_at.toISOString()}::timestamptz`)).map((r) => r.id)
      : [m.id];
  await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE meetings SET status = 'cancelled', updated_at = now() WHERE id IN ${ids}`);
    await history(tx, m.id, actor, ids.length > 1 ? `cancelled it and ${ids.length - 1} later meetings` : "cancelled it");
    const nm = await nameOf(tx, actor);
    await notify(tx, [m.organizer, ...m.people].filter((p) => p !== actor), `${nm} cancelled ${m.title} (${fmtDay(m.starts_at.getTime())} ${fmtTime(m.starts_at.getTime())})${ids.length > 1 ? " and the later meetings in the series" : ""}.`, m.id);
  });
  return c.json({ ok: true, cancelled: ids.length });
});

app.post("/meetings/:id{[0-9]+}/:act{start|end}", async (c) => {
  const db = getDb(c.env);
  const actor = await me(c, db);
  const m = await getMeeting(db, Number(c.req.param("id")));
  if (!m) return c.json({ error: "That meeting is not there any more." }, 404);
  if (!mayChange(m, actor)) return c.json({ error: "Only the organiser can start or end this meeting." }, 403);
  const now = Date.now();
  const st = effStatus(m, now);
  if (st === "ended") return c.json({ error: "This meeting has already ended." }, 409);
  if (c.req.param("act") === "start") {
    if (st === "live" && m.started_at) return c.json({ ok: true });
    await db.execute(sql`UPDATE meetings SET status = 'live', started_at = now(), updated_at = now() WHERE id = ${m.id}`);
    await history(db, m.id, actor, "started it");
  } else {
    // Ending early frees the room from now: the end time moves to now.
    const end = Math.max(m.starts_at.getTime() + 5 * MIN, Math.min(m.ends_at.getTime(), now));
    await db.execute(sql`UPDATE meetings SET status = 'ended', ended_at = now(), ends_at = ${iso(end)}::timestamptz, updated_at = now() WHERE id = ${m.id}`);
    await history(db, m.id, actor, "ended it");
  }
  return c.json({ ok: true });
});

/* ---------- files ---------- */

app.post("/meetings/:id{[0-9]+}/files", async (c) => {
  const db = getDb(c.env);
  const actor = await me(c, db);
  const m = await getMeeting(db, Number(c.req.param("id")));
  if (!m) return c.json({ error: "That meeting is not there any more." }, 404);
  if (!mayChange(m, actor) && !m.people.includes(actor)) return c.json({ error: "Only people in this meeting can add files." }, 403);
  const form = await c.req.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) return c.json({ error: "No file was sent." }, 400);
  if (files.length > 10) return c.json({ error: "At most 10 files at a time." }, 400);
  const tooBig = files.find((f) => f.size > MAX_FILE);
  if (tooBig) return c.json({ error: `${tooBig.name} is larger than 25 MB.` }, 413);
  const saved: { id: number; file_name: string }[] = [];
  for (const f of files) {
    const key = `meetings/${m.id}/${crypto.randomUUID()}`;
    await c.env.FILES.put(key, f.stream(), { httpMetadata: { contentType: f.type || "application/octet-stream" } });
    const [row] = await rows<{ id: number }>(db, sql`INSERT INTO meeting_files (meeting_id, r2_key, file_name, mime_type, size_bytes, uploaded_by)
      VALUES (${m.id}, ${key}, ${f.name.slice(0, 200)}, ${f.type || "application/octet-stream"}, ${f.size}, ${actor}) RETURNING id`);
    saved.push({ id: row.id, file_name: f.name });
  }
  await history(db, m.id, actor, `added ${saved.length === 1 ? saved[0].file_name : `${saved.length} files`}`);
  return c.json({ ok: true, files: saved }, 201);
});

app.get("/meetings/:id{[0-9]+}/files/:fid{[0-9]+}", async (c) => {
  const db = getDb(c.env);
  const key = await me(c, db);
  const [f] = await rows<{ r2_key: string; file_name: string; mime_type: string }>(
    db,
    sql`SELECT f.r2_key, f.file_name, f.mime_type FROM meeting_files f JOIN meetings m ON m.id = f.meeting_id
        WHERE f.id = ${Number(c.req.param("fid"))} AND f.meeting_id = ${Number(c.req.param("id"))} AND m.status <> 'cancelled' AND ${visibleTo(key)}`,
  );
  if (!f) return c.json({ error: "File not found" }, 404);
  const obj = await c.env.FILES.get(f.r2_key);
  if (!obj) return c.json({ error: "File not found" }, 404);
  return new Response(obj.body, {
    headers: { "Content-Type": f.mime_type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.file_name)}`, "X-Content-Type-Options": "nosniff" },
  });
});

/* ---------- my meetings and notifications ---------- */

app.get("/mine", async (c) => {
  const db = getDb(c.env);
  const key = await me(c, db);
  const ms = await rows<MeetingRow>(
    db,
    sql`SELECT ${MEETING_COLS} FROM meetings m WHERE status <> 'cancelled' AND ends_at > now() - interval '1 day'
        AND (organizer = ${key} OR booked_by = ${key} OR EXISTS (SELECT 1 FROM meeting_attendees a WHERE a.meeting_id = m.id AND a.person_key = ${key}))
        ORDER BY starts_at LIMIT 200`,
  );
  const notes = await rows<{ id: number; meeting_id: number | null; text: string; created_at: Date; read_at: Date | null }>(
    db,
    sql`SELECT id, meeting_id, text, created_at, read_at FROM meeting_notifications WHERE person_key = ${key} ORDER BY created_at DESC LIMIT 50`,
  );
  const now = Date.now();
  return c.json({
    meetings: (await withPeople(db, ms)).map((m) => publicMeeting(m, now)),
    notifications: notes.map((n) => ({ id: n.id, meetingId: n.meeting_id, text: n.text, at: n.created_at.toISOString(), read: Boolean(n.read_at) })),
  });
});

app.get("/unread", async (c) => {
  const db = getDb(c.env);
  const key = await me(c, db);
  const [r] = await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM meeting_notifications WHERE person_key = ${key} AND read_at IS NULL`);
  return c.json({ unread: r?.n ?? 0 });
});

app.post("/notifications/read", async (c) => {
  const db = getDb(c.env);
  const key = await me(c, db);
  await db.execute(sql`UPDATE meeting_notifications SET read_at = now() WHERE person_key = ${key} AND read_at IS NULL`);
  return c.json({ ok: true });
});

/* ---------- rooms (Manage meeting rooms) ---------- */

function readRoom(b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) throw new MeetingInputError("Give the room a name.");
  const seats = Math.trunc(Number(b.seats));
  if (!(seats >= 1 && seats <= 500)) throw new MeetingInputError("Seats must be between 1 and 500.");
  const days = (Array.isArray(b.days) ? b.days : [1, 2, 3, 4, 5]).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const from = Math.trunc(Number(b.openFrom ?? 9));
  const to = Math.trunc(Number(b.openTo ?? 18));
  if (!(from >= 0 && from < to && to <= 24)) throw new MeetingInputError("Opening hours must close after they open.");
  const closures = (Array.isArray(b.closures) ? b.closures : [])
    .slice(0, 100)
    .map((x) => x as Record<string, unknown>)
    .filter((x) => isoOk(x.from))
    .map((x) => ({ from: x.from as string, to: isoOk(x.to) && (x.to as string) >= (x.from as string) ? (x.to as string) : (x.from as string), reason: String(x.reason ?? "").slice(0, 120) }));
  const color = /^#[0-9a-fA-F]{6}$/.test(String(b.color)) ? String(b.color) : "#0b8043";
  return {
    name,
    location: String(b.location ?? "").trim().slice(0, 80),
    floor: String(b.floor ?? "").trim().slice(0, 80),
    seats,
    equipment: (Array.isArray(b.equipment) ? b.equipment : []).map((e) => String(e).trim().slice(0, 40)).filter(Boolean).slice(0, 20),
    days: [...new Set(days)],
    from,
    to,
    color,
    buffer: Math.max(0, Math.min(120, Math.trunc(Number(b.bufferMin) || 0))),
    maxHours: Math.max(0, Math.min(24, Math.trunc(Number(b.maxHours) || 0))),
    advance: Math.max(0, Math.min(730, Math.trunc(Number(b.advanceDays) || 0))),
    active: b.active !== false,
    closures,
  };
}

async function saveClosures(tx: Pick<DB, "execute">, roomId: number, closures: { from: string; to: string; reason: string }[]) {
  await tx.execute(sql`DELETE FROM meeting_room_closures WHERE room_id = ${roomId}`);
  for (const x of closures) await tx.execute(sql`INSERT INTO meeting_room_closures (room_id, from_date, to_date, reason) VALUES (${roomId}, ${x.from}::date, ${x.to}::date, ${x.reason})`);
}

app.post("/rooms", async (c) => {
  if (!canManage(c)) return c.json({ error: "You need Manage meeting rooms to add a room." }, 403);
  const db = getDb(c.env);
  const actor = await me(c, db);
  const r = readRoom((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
  const id = await db.transaction(async (tx) => {
    const [row] = await rows<{ id: number }>(
      tx,
      sql`INSERT INTO meeting_rooms (name, location, floor, seats, equipment, open_days, open_from, open_to, color, buffer_min, max_hours, advance_days, active, updated_by)
          VALUES (${r.name}, ${r.location}, ${r.floor}, ${r.seats}, ${toPgTextArray(r.equipment)}, ${toPgIntArray(r.days)}, ${r.from}, ${r.to}, ${r.color}, ${r.buffer}, ${r.maxHours}, ${r.advance}, ${r.active}, ${actor}) RETURNING id`,
    );
    await saveClosures(tx, row.id, r.closures);
    await tx.execute(sql`INSERT INTO meeting_admin_log (who, text) VALUES (${actor}, ${`Added room ${r.name} (${r.seats} seats${r.location ? `, ${r.location}` : ""}${r.floor ? `, ${r.floor}` : ""})`})`);
    return row.id;
  });
  return c.json({ ok: true, id }, 201);
});

app.patch("/rooms/:id{[0-9]+}", async (c) => {
  if (!canManage(c)) return c.json({ error: "You need Manage meeting rooms to change a room." }, 403);
  const db = getDb(c.env);
  const actor = await me(c, db);
  const id = Number(c.req.param("id"));
  const r = readRoom((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
  const found = await db.transaction(async (tx) => {
    const res = await rows<{ id: number }>(
      tx,
      sql`UPDATE meeting_rooms SET name = ${r.name}, location = ${r.location}, floor = ${r.floor}, seats = ${r.seats}, equipment = ${toPgTextArray(r.equipment)},
          open_days = ${toPgIntArray(r.days)}, open_from = ${r.from}, open_to = ${r.to}, color = ${r.color}, buffer_min = ${r.buffer}, max_hours = ${r.maxHours},
          advance_days = ${r.advance}, active = ${r.active}, updated_at = now(), updated_by = ${actor} WHERE id = ${id} RETURNING id`,
    );
    if (!res.length) return false;
    await saveClosures(tx, id, r.closures);
    await tx.execute(sql`INSERT INTO meeting_admin_log (who, text) VALUES (${actor}, ${`Changed room ${r.name} (${r.seats} seats, ${r.active ? "open" : "closed"} for booking)`})`);
    return true;
  });
  if (!found) return c.json({ error: "Room not found" }, 404);
  const [f] = await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM meetings WHERE room_id = ${id} AND status <> 'cancelled' AND starts_at > now()`);
  return c.json({ ok: true, futureBookings: f?.n ?? 0 });
});

app.get("/log", async (c) => {
  if (!canManage(c)) return c.json({ error: "You need Manage meeting rooms to see the change log." }, 403);
  const db = getDb(c.env);
  await me(c, db);
  const l = await rows<{ at: Date; who: string; text: string }>(db, sql`SELECT at, who, text FROM meeting_admin_log ORDER BY at DESC LIMIT 300`);
  return c.json({ log: l.map((x) => ({ at: x.at.toISOString(), who: x.who, text: x.text })) });
});

/* ---------- guest booking links ---------- */

type LinkRow = { id: number; code: string; name: string; room_ids: number[]; length_min: number; days: number[]; from_hour: number; to_hour: number; until: string | null; host_keys: string[]; created_in: string; active: boolean; created_by: string; audience: string };
const LINK_COLS = sql`id, code, name, room_ids, length_min, days, from_hour, to_hour, until::text AS until, host_keys, created_in, active, created_by, audience`;
const publicLink = (l: LinkRow) => ({ id: l.id, code: l.code, name: l.name, rooms: l.room_ids, length: l.length_min, days: l.days, from: l.from_hour, to: l.to_hour, until: l.until, hosts: l.host_keys, createdIn: l.created_in, active: l.active, createdBy: l.created_by, audience: l.audience });

app.get("/links", async (c) => {
  const db = getDb(c.env);
  await me(c, db);
  const ls = await rows<LinkRow>(db, sql`SELECT ${LINK_COLS} FROM meeting_links ORDER BY created_at DESC`);
  const counts = await rows<{ link_id: number; n: number }>(db, sql`SELECT link_id, count(*)::int AS n FROM meetings WHERE link_id IS NOT NULL AND status <> 'cancelled' GROUP BY link_id`);
  return c.json({ links: ls.map((l) => ({ ...publicLink(l), booked: counts.find((x) => x.link_id === l.id)?.n ?? 0 })) });
});

app.post("/links", async (c) => {
  const db = getDb(c.env);
  const actor = await me(c, db);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(b.name ?? "").trim().slice(0, 80) || `Booking link ${localIso(Date.now())}`;
  // No rooms, days or hours given: every room, every day, each room's own opening hours (owner, 2026-11-23).
  const roomIds = (Array.isArray(b.rooms) ? b.rooms : []).map(Number).filter(Number.isInteger);
  const hosts = (Array.isArray(b.hosts) ? b.hosts : []).map(String).filter(Boolean).slice(0, 20);
  const givenDays = (Array.isArray(b.days) ? b.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const days = givenDays.length ? givenDays : [0, 1, 2, 3, 4, 5, 6];
  const len = b.length === undefined ? 480 : Math.trunc(Number(b.length));
  const from = b.from === undefined ? 0 : Math.trunc(Number(b.from));
  const to = b.to === undefined ? 24 : Math.trunc(Number(b.to));
  // Hosts are the people told about each booking; a link may have none.

  const audience = b.audience === "staff" ? "staff" : "anyone";
  if (!(len >= 15 && len <= 480) || !(from >= 0 && from < to && to <= 24)) return c.json({ error: "Check the length and the hours." }, 400);
  const until = isoOk(b.until) ? (b.until as string) : null;
  const code = `${c.get("systemCode").toLowerCase().slice(0, 4)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const [row] = await rows<{ id: number }>(
    db,
    sql`INSERT INTO meeting_links (code, name, room_ids, length_min, days, from_hour, to_hour, until, host_keys, created_in, created_by, audience)
        VALUES (${code}, ${name}, ${toPgIntArray(roomIds)}, ${len}, ${toPgIntArray([...new Set(days)])}, ${from}, ${to}, ${until}::date, ${toPgTextArray(hosts)}, ${c.get("systemCode")}, ${actor}, ${audience}) RETURNING id`,
  );
  await db.execute(sql`INSERT INTO meeting_admin_log (who, text) VALUES (${actor}, ${`Created guest link ${name}${until ? ` until ${until}` : " with no end date"}`})`);
  return c.json({ ok: true, id: row.id, code }, 201);
});

app.patch("/links/:id{[0-9]+}", async (c) => {
  const db = getDb(c.env);
  const actor = await me(c, db);
  const b = (await c.req.json().catch(() => ({}))) as { active?: unknown };
  const [l] = await rows<LinkRow>(db, sql`SELECT ${LINK_COLS} FROM meeting_links WHERE id = ${Number(c.req.param("id"))}`);
  if (!l) return c.json({ error: "Link not found" }, 404);
  if (l.created_by !== actor && !l.host_keys.includes(actor) && !canManage(c)) return c.json({ error: "Only the person who made the link, its hosts or a room manager can change it." }, 403);
  await db.execute(sql`UPDATE meeting_links SET active = ${b.active !== false} WHERE id = ${l.id}`);
  await db.execute(sql`INSERT INTO meeting_admin_log (who, text) VALUES (${actor}, ${`${b.active !== false ? "Turned on" : "Turned off"} guest link ${l.name}`})`);
  return c.json({ ok: true });
});

/* ---------- public (guest) — proxied by the ERP that owns the link's address ---------- */

/** The link's rooms: the ones it lists, or every room when it lists none (rooms added later included). */
const linkHas = (l: LinkRow, roomId: number) => l.room_ids.length === 0 || l.room_ids.includes(roomId);

async function openLink(db: DB, code: string): Promise<LinkRow | null> {
  const [l] = await rows<LinkRow>(db, sql`SELECT ${LINK_COLS} FROM meeting_links WHERE code = ${code}`);
  if (!l || !l.active || (l.until && l.until < localIso(Date.now()))) return null;
  return l;
}

/** Times a guest may take on a day: a host free, a room from the link free and allowed, at least 4 hours from now. */
async function guestSlots(db: DB, l: LinkRow, dayIso: string, now: number) {
  const rooms = (await loadRooms(db)).filter((r) => linkHas(l, r.id));
  const dayStart = atLocal(dayIso, 0);
  const busy = await busyBetween(db, dayStart - DAY, dayStart + 2 * DAY, now);
  const len = l.length_min * MIN;
  const out: { start: string; end: string; roomId: number; host: string }[] = [];
  if (!l.days.includes(localDay(dayStart + 12 * HOUR)) || (l.until && dayIso > l.until)) return out;
  const step = Math.max(30, l.length_min) * MIN;
  for (let t = atLocal(dayIso, l.from_hour); t + len <= atLocal(dayIso, l.to_hour); t += step) {
    if (t < now + 4 * HOUR) continue;
    const room = rooms.find((r) => !hasConflict(conflictsIn(busy, rooms, { id: null, start: t, end: t + len, roomId: r.id, people: [] }, now)));
    const host = l.host_keys.find((h) => !busy.some((b) => b.people.includes(h) && b.start < t + len && t < b.end));
    if (room && host) out.push({ start: iso(t), end: iso(t + len), roomId: room.id, host });
  }
  return out;
}

app.get("/public/links/:code", async (c) => {
  const db = getDb(c.env);
  const l = await openLink(db, c.req.param("code"));
  if (!l) return c.json({ error: "This booking link is not active." }, 404);
  const rooms = (await loadRooms(db)).filter((r) => linkHas(l, r.id));
  // A guest sees the link, its rooms and our company / department names, never who else has booked.
  const orgs = await rows<{ company: string; department: string }>(
    db,
    sql`SELECT DISTINCT company, department FROM meeting_people WHERE active AND company <> '' ORDER BY company, department`,
  );
  const companies: { name: string; departments: string[] }[] = [];
  for (const o of orgs) {
    let co = companies.find((x) => x.name === o.company);
    if (!co) companies.push((co = { name: o.company, departments: [] }));
    if (o.department && !co.departments.includes(o.department)) co.departments.push(o.department);
  }
  return c.json({
    link: {
      code: l.code, name: l.name, length: l.length_min, maxMinutes: l.length_min, days: l.days, from: l.from_hour, to: l.to_hour, until: l.until,
      createdIn: l.created_in, location: rooms[0]?.location ?? "", audience: l.audience,
      rooms: rooms.filter((r) => r.active).map((r) => ({
        id: r.id, name: r.name, seats: r.seats, location: r.location, floor: r.floor, equipment: r.equipment,
        openDays: r.open_days, openFrom: r.open_from, openTo: r.open_to, maxHours: r.max_hours,
      })),
    },
    companies,
  });
});

/** One day of a link: for each of its rooms, the times already taken (no titles, no people) and whether it is closed. */
app.get("/public/links/:code/day", async (c) => {
  const db = getDb(c.env);
  const l = await openLink(db, c.req.param("code"));
  if (!l) return c.json({ error: "This booking link is not active." }, 404);
  const day = c.req.query("day");
  if (!isoOk(day)) return c.json({ error: "day=YYYY-MM-DD is required" }, 400);
  const now = Date.now();
  const dayStart = atLocal(day, 0);
  const open = l.days.includes(localDay(dayStart + 12 * HOUR)) && !(l.until && day > l.until);
  const rooms = (await loadRooms(db)).filter((r) => linkHas(l, r.id) && r.active);
  const busy = await busyBetween(db, dayStart, dayStart + DAY, now);
  const from = atLocal(day, l.from_hour);
  const to = atLocal(day, l.to_hour);
  return c.json({
    day,
    open,
    rooms: rooms.map((r) => {
      const closure = r.closures.find((x) => x.from <= day && day <= x.to);
      const wd = localDay(dayStart + 12 * HOUR);
      const winFrom = Math.max(l.from_hour, r.open_from) * 60;
      const winTo = Math.min(l.to_hour, r.open_to) * 60;
      const closed = closure ? closure.reason || "Closed" : !r.open_days.includes(wd) ? "Not open this day" : winFrom >= winTo ? "Not open these hours" : null;
      return {
        id: r.id,
        closed,
        from: winFrom,
        to: winTo,
        busy: busy
          .filter((b) => b.room_id === r.id && b.start < to && from < b.end)
          .map((b) => ({ start: iso(Math.max(b.start, from)), end: iso(Math.min(b.end, to)) }))
          .sort((a, b) => a.start.localeCompare(b.start)),
      };
    }),
  });
});

app.get("/public/links/:code/slots", async (c) => {
  const db = getDb(c.env);
  const l = await openLink(db, c.req.param("code"));
  if (!l) return c.json({ error: "This booking link is not active." }, 404);
  const day = c.req.query("day");
  if (!isoOk(day)) return c.json({ error: "day=YYYY-MM-DD is required" }, 400);
  const slots = await guestSlots(db, l, day, Date.now());
  return c.json({ slots: slots.map((s) => ({ start: s.start, end: s.end })) });
});

app.post("/public/links/:code/book", async (c) => {
  const db = getDb(c.env);
  const l = await openLink(db, c.req.param("code"));
  if (!l) return c.json({ error: "This booking link is not active." }, 404);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const guest = {
    name: String(b.name ?? "").trim().slice(0, 100),
    phone: String(b.phone ?? "").trim().slice(0, 40),
    email: String(b.email ?? "").trim().slice(0, 200),
    company: String(b.company ?? "").trim().slice(0, 120),
    department: String(b.department ?? "").trim().slice(0, 120),
    people: Math.max(1, Math.min(200, Math.trunc(Number(b.people) || 1))),
  };
  if (!guest.name || !guest.phone || !/^[^@\s]+@[^@\s]+$/.test(guest.email)) return c.json({ error: "Fill in your name, phone and a valid email." }, 400);
  if (!tOk(b.start)) return c.json({ error: "Pick a time." }, 400);
  const start = new Date(b.start as string).getTime();
  const now = Date.now();
  // The second shape: the guest picked the room and the end time (the page from 2026-11-23 on).
  const picked = b.roomId !== undefined || b.end !== undefined;
  const title = String(b.title ?? "").trim().slice(0, 200);
  let end = 0;
  let roomId = 0;
  if (picked) {
    if (!tOk(b.end)) return c.json({ error: "Pick an end time." }, 400);
    end = new Date(b.end as string).getTime();
    roomId = Math.trunc(Number(b.roomId));
    const day = localIso(start);
    const why = [
      !linkHas(l, roomId) && "That room is not open through this link.",
      !title && "Give the meeting a title.",
      !guest.company && "Fill in your company.",
      start <= now && "That time has passed. Pick a later one.",
      !(end > start) && "The end must be after the start.",
      end - start > l.length_min * MIN && `A booking through this link is at most ${l.length_min >= 60 ? `${l.length_min / 60} hours` : `${l.length_min} minutes`}.`,
      (start % (15 * MIN) !== 0 || end % (15 * MIN) !== 0) && "Pick times on the quarter hour.",
      (!l.days.includes(localDay(start)) || (l.until && day > l.until)) && "This link is not open on that day.",
      (start < atLocal(day, l.from_hour) || end > atLocal(day, l.to_hour)) && `This link is open ${l.from_hour}:00 to ${l.to_hour}:00.`,
    ].filter(Boolean) as string[];
    if (why.length) return c.json({ error: why[0] }, 400);
    if (l.audience === "staff") {
      const [known] = await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM meeting_people WHERE active AND company = ${guest.company}`);
      if (!known?.n) return c.json({ error: "This link is for our staff. Choose your company from the list." }, 400);
    }
  }
  // Spam guard: one person at most 2 bookings a day through links.
  const [recent] = await rows<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM meetings WHERE link_id IS NOT NULL AND status <> 'cancelled' AND created_at > now() - interval '1 day'
        AND (lower(guest->>'email') = ${guest.email.toLowerCase()} OR regexp_replace(guest->>'phone', '[^0-9]', '', 'g') = ${guest.phone.replace(/[^0-9]/g, "")})`,
  );
  if ((recent?.n ?? 0) >= 2) return c.json({ error: "You already booked twice today. Please contact us to book more." }, 429);
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  if (picked) {
    // Nobody to tell: the person who made the link owns the booking (can change or cancel it) and is told.
    const hosts = l.host_keys.length ? l.host_keys : [l.created_by];
    const res = await db.transaction(async (tx) => {
      await lockRoom(tx, roomId);
      const rooms = await loadRooms(tx);
      const room = rooms.find((r) => r.id === roomId);
      if (!room || !room.active) return { error: "That room is not open for booking.", status: 409 as const };
      if (room.seats && guest.people > room.seats) return { error: `${room.name} seats ${room.seats}. Pick a bigger room or fewer people.`, status: 400 as const };
      if (!inHours(room, start, end)) return { error: `${room.name} is open ${room.open_from}:00 to ${room.open_to}:00 on its open days. Pick a time inside those hours.`, status: 400 as const };
      const busy = await busyBetween(tx as unknown as DB, start - DAY, end + DAY, now);
      const conflict = conflictsIn(busy, rooms, { id: null, start, end, roomId, people: [] }, now);
      if (conflict.room) return { error: `${room.name} is taken ${fmtTime(conflict.room.start)} - ${fmtTime(conflict.room.end)} (with the gap the room keeps between meetings). Pick another time or room.`, status: 409 as const };
      if (conflict.rules.length) return { error: conflict.rules[0], status: 409 as const };
      const organizer = hosts[0];
      const [row] = await rows<{ id: number }>(
        tx,
        sql`INSERT INTO meetings (title, starts_at, ends_at, room_id, organizer, booked_by, created_in, link_id, guest, guest_token, reminders)
            VALUES (${title}, ${iso(start)}::timestamptz, ${iso(end)}::timestamptz, ${roomId}, ${organizer}, ${"guest"}, ${l.created_in}, ${l.id},
                    ${JSON.stringify(guest)}::jsonb, ${token}, ${'[{"min":60,"ch":["erp"]}]'}::jsonb) RETURNING id`,
      );
      for (const h of hosts.slice(1)) await tx.execute(sql`INSERT INTO meeting_attendees (meeting_id, person_key) VALUES (${row.id}, ${h}) ON CONFLICT DO NOTHING`);
      await history(tx, row.id, "guest", `${guest.name} (${guest.company}) booked it through the link ${l.name}`);
      {
        await notify(tx, hosts, `${guest.name} (${guest.company}${guest.department ? `, ${guest.department}` : ""}) booked ${room.name} through the link ${l.name}: ${title}, ${fmtDay(start)} ${fmtTime(start)} - ${fmtTime(end)}, ${guest.people} people.`, row.id);
      }
      return { id: row.id, title, people: guest.people, start: iso(start), end: iso(end), room: { name: room.name, floor: room.floor, location: room.location } };
    });
    if ("error" in res) return c.json({ error: res.error }, res.status);
    return c.json({ ok: true, token, booking: { ...res, code: `MTG-${String(res.id).padStart(4, "0")}` } }, 201);
  }
  const out = await db.transaction(async (tx) => {
    for (const rid of l.room_ids.length ? l.room_ids : (await loadRooms(tx)).map((r) => r.id)) await lockRoom(tx, rid);
    const slot = (await guestSlots(tx as unknown as DB, l, localIso(start), now)).find((s) => Date.parse(s.start) === start);
    if (!slot) return null;
    const [row] = await rows<{ id: number }>(
      tx,
      sql`INSERT INTO meetings (title, starts_at, ends_at, room_id, organizer, booked_by, created_in, link_id, guest, guest_token, reminders)
          VALUES (${`${l.name}: ${guest.name}`}, ${slot.start}::timestamptz, ${slot.end}::timestamptz, ${slot.roomId}, ${slot.host}, ${"guest"}, ${l.created_in}, ${l.id},
                  ${JSON.stringify(guest)}::jsonb, ${token}, ${'[{"min":60,"ch":["erp"]}]'}::jsonb) RETURNING id`,
    );
    await history(tx, row.id, "guest", `${guest.name} booked it through the link ${l.name}`);
    const room = (await loadRooms(tx)).find((r) => r.id === slot.roomId);
    await notify(tx, [slot.host], `A guest booked ${room?.name ?? "a room"} through the link ${l.name}: ${guest.name}${guest.company ? ` (${guest.company})` : ""}, ${fmtDay(start)} ${fmtTime(start)}. You host.`, row.id);
    return { id: row.id, start: slot.start, end: slot.end, room: room ? { name: room.name, floor: room.floor, location: room.location } : null };
  });
  if (!out) return c.json({ error: "Someone just took that time. Pick another one." }, 409);
  return c.json({ ok: true, token, booking: { ...out, code: `MTG-${String(out.id).padStart(4, "0")}` } }, 201);
});

app.get("/public/bookings/:token{[0-9a-f]{64}}", async (c) => {
  const db = getDb(c.env);
  const [m] = await rows<MeetingRow & { room_name: string | null; floor: string | null; location: string | null }>(
    db,
    sql`SELECT m.id, m.title, m.starts_at, m.ends_at, m.status, m.guest, r.name AS room_name, r.floor, r.location FROM meetings m LEFT JOIN meeting_rooms r ON r.id = m.room_id WHERE m.guest_token = ${c.req.param("token")}`,
  );
  if (!m) return c.json({ error: "Booking not found" }, 404);
  return c.json({ booking: { code: `MTG-${String(m.id).padStart(4, "0")}`, title: m.title, people: (m.guest as { people?: number } | null)?.people ?? null, start: m.starts_at.toISOString(), end: m.ends_at.toISOString(), cancelled: m.status === "cancelled", room: m.room_name, floor: m.floor, location: m.location } });
});

app.post("/public/bookings/:token{[0-9a-f]{64}}/cancel", async (c) => {
  const db = getDb(c.env);
  const [m] = await rows<MeetingRow>(db, sql`SELECT ${MEETING_COLS} FROM meetings WHERE guest_token = ${c.req.param("token")} AND status <> 'cancelled'`);
  if (!m) return c.json({ error: "Booking not found or already cancelled" }, 404);
  await db.execute(sql`UPDATE meetings SET status = 'cancelled', updated_at = now() WHERE id = ${m.id}`);
  await history(db, m.id, "guest", "the guest cancelled it");
  await notify(db, [m.organizer], `Guest ${m.guest?.name ?? ""} cancelled ${fmtDay(m.starts_at.getTime())} ${fmtTime(m.starts_at.getTime())}.`, m.id);
  return c.json({ ok: true });
});

// Guests may only reach /public; everything else needs a signed-in person.
export const meetingsCore = app;
export const sysMeetings = new Hono<SysApp>();
sysMeetings.use("*", systemAuth);
sysMeetings.use("*", async (c, next) => {
  if (c.req.header("X-Reporter-Id")?.trim() === "guest" && !c.req.path.includes("/meetings/public/")) return c.json({ error: "Not allowed for guests" }, 403);
  await next();
});
sysMeetings.route("/", app);

