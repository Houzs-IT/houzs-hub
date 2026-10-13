import { and, count, desc, eq, gt, inArray, isNull, max, ne, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema, type DB } from "../db/client";
import { need } from "../middleware/devAuth";
import type { DevApp, DevVars } from "../types";

const notifications = new Hono<DevApp>();
notifications.use("*", need("it"));

const events = schema.ticketEvents;
const tickets = schema.tickets;
const PAGE_SIZE = 20;

const FILTERS: Record<string, SQL> = {
  tickets: eq(events.kind, "created"),
  comments: eq(events.kind, "comment"),
  closed: and(eq(events.kind, "status"), inArray(events.toValue, ["resolved", "closed"]))!,
};

// New tickets, comments, and tickets resolved or closed, done by someone else.
function notificationWhere(userId: number, filter?: string, afterId?: number) {
  return and(
    FILTERS[filter ?? ""] ?? or(...Object.values(FILTERS)),
    or(isNull(events.userId), ne(events.userId, userId)),
    afterId ? gt(events.id, afterId) : undefined,
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

export async function countUnread(db: DB, user: DevVars["user"]) {
  const seenId = await getSeenId(db, user);
  const [unread] = await db.select({ n: count() }).from(events).where(notificationWhere(user.id, undefined, seenId));
  return unread?.n ?? 0;
}

// unread=1 lists events after the read mark; `after` pins that mark so marking
// read while the page is open does not empty the Unread only view.
notifications.get("/", async (c) => {
  const db = getDb(c.env);
  const me = c.get("user");
  const query = c.req.query();
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(query.page_size) || PAGE_SIZE));
  const seenId = await getSeenId(db, me);
  const afterId = query.unread === "1" ? Number(query.after) || seenId : undefined;
  const where = notificationWhere(me.id, query.filter, afterId);

  const [rows, [total]] = await Promise.all([
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
      })
      .from(events)
      .innerJoin(tickets, eq(tickets.id, events.ticketId))
      .where(where)
      .orderBy(desc(events.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(events).where(where),
  ]);

  return c.json({ notifications: rows, total: total?.n ?? 0, page, page_size: pageSize, seen_id: seenId });
});

// Marks read up to `up_to`, or everything when it is missing. The mark never moves back.
notifications.post("/read", async (c) => {
  const db = getDb(c.env);
  const me = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as { up_to?: unknown };
  const upTo = Number(body.up_to);
  const seenId = Number.isInteger(upTo) && upTo > 0 ? upTo : await newestEventId(db);
  await db
    .update(schema.users)
    .set({ notificationsSeenId: sql`GREATEST(COALESCE(${schema.users.notificationsSeenId}, 0), ${seenId})` })
    .where(eq(schema.users.id, me.id));
  return c.json({ ok: true });
});

export default notifications;
