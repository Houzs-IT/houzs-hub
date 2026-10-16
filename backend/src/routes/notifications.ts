import { and, count, desc, eq, gt, inArray, isNull, lte, max, ne, not, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { schema, type DB } from "../db/client";
import { need } from "../middleware/devAuth";
import type { DevApp, DevVars } from "../types";

const notifications = new Hono<DevApp>();
notifications.use("*", need("it"));

const events = schema.ticketEvents;
const tickets = schema.tickets;
const reads = schema.notificationReads;
const PAGE_SIZE = 20;

const FILTERS: Record<string, SQL> = {
  tickets: eq(events.kind, "created"),
  comments: eq(events.kind, "comment"),
  closed: and(eq(events.kind, "status"), inArray(events.toValue, ["resolved", "closed"]))!,
};

function readOneByOne(userId: number) {
  return sql<boolean>`EXISTS (SELECT 1 FROM ${reads} WHERE ${reads.userId} = ${userId} AND ${reads.eventId} = ${events.id})`;
}

// New tickets, comments, and tickets resolved or closed, done by someone else.
// With `unreadAfter` (the read mark), only the ones after it not read one by one.
function notificationWhere(userId: number, filter?: string, unreadAfter?: number) {
  return and(
    FILTERS[filter ?? ""] ?? or(...Object.values(FILTERS)),
    or(isNull(events.userId), ne(events.userId, userId)),
    unreadAfter !== undefined ? and(gt(events.id, unreadAfter), not(readOneByOne(userId))) : undefined,
  );
}

async function newestEventId(db: DB) {
  const [newest] = await db.select({ id: max(events.id) }).from(events);
  return newest?.id ?? 0;
}

// A first visit starts from the newest event, so nobody inherits the whole history as unread.
async function getSeenId(db: DB, user: DevVars["user"]) {
  if (user.notificationsSeenId !== null) return user.notificationsSeenId;
  const seenId = await newestEventId(db);
  await db.update(schema.users).set({ notificationsSeenId: seenId }).where(eq(schema.users.id, user.id));
  return seenId;
}

// Counts stop at `cap`: events grow fastest of any table, and the UI only shows "99+" / "1000+".
async function cappedCount(db: DB, where: SQL | undefined, cap: number) {
  const capped = db.select({ one: sql`1` }).from(events).where(where).limit(cap).as("capped");
  const [row] = await db.select({ n: count() }).from(capped);
  return row?.n ?? 0;
}

export const UNREAD_CAP = 100;
const TOTAL_CAP = 1001;

export async function countUnread(db: DB, user: DevVars["user"]) {
  const seenId = await getSeenId(db, user);
  return cappedCount(db, notificationWhere(user.id, undefined, seenId), UNREAD_CAP);
}

notifications.get("/", async (c) => {
  const db = c.get("db");
  const me = c.get("user");
  const query = c.req.query();
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(query.page_size) || PAGE_SIZE));
  const seenId = await getSeenId(db, me);
  const where = notificationWhere(me.id, query.filter, query.unread === "1" ? seenId : undefined);

  const [rows, total] = await Promise.all([
    db
      .select({
        id: events.id,
        kind: events.kind,
        visibility: events.visibility,
        author_name: events.authorName,
        body: sql<string | null>`left(${events.body}, 160)`,
        to_value: events.toValue,
        created_at: events.createdAt,
        ticket_code: tickets.code,
        ticket_title: tickets.title,
        is_read: sql<boolean>`${events.id} <= ${seenId} OR ${readOneByOne(me.id)}`,
      })
      .from(events)
      .innerJoin(tickets, eq(tickets.id, events.ticketId))
      .where(where)
      .orderBy(desc(events.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    cappedCount(db, where, TOTAL_CAP),
  ]);

  // ponytail: OFFSET paging and a capped total; switch to "older than id" paging if people dig past ~50 pages.
  return c.json({ notifications: rows, total, total_capped: total >= TOTAL_CAP, page, page_size: pageSize });
});

// Marks one notification read with `id`, or all of them without it.
notifications.post("/read", async (c) => {
  const db = c.get("db");
  const me = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as { id?: unknown };

  if (body.id !== undefined) {
    const eventId = Number(body.id);
    if (!Number.isInteger(eventId) || eventId <= 0) return c.json({ error: "Invalid notification id" }, 400);
    await db.execute(
      sql`INSERT INTO ${reads} (user_id, event_id) SELECT ${me.id}, ${events.id} FROM ${events} WHERE ${events.id} = ${eventId} ON CONFLICT DO NOTHING`,
    );
    return c.json({ ok: true });
  }

  const seenId = await newestEventId(db);
  await db
    .update(schema.users)
    .set({ notificationsSeenId: sql`GREATEST(COALESCE(${schema.users.notificationsSeenId}, 0), ${seenId})` })
    .where(eq(schema.users.id, me.id));
  await db.delete(reads).where(and(eq(reads.userId, me.id), lte(reads.eventId, seenId)));
  return c.json({ ok: true });
});

export default notifications;
