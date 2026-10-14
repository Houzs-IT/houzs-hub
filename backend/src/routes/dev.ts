import { and, asc, count, desc, eq, gt, inArray, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { schema, type DB } from "../db/client";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  type User,
  type Ticket,
  type TicketStatus,
} from "../db/schema";
import { devAuth, need } from "../middleware/devAuth";
import { EMAIL_RE, MIN_PASSWORD, hashPassword, verifyPassword } from "../services/crypto";
import {
  ACTIVE_STATUSES,
  InputError,
  addEvent,
  nowIso,
  oneOf,
  readInput,
  saveAttachments,
  str,
  streamAttachment,
  TooLargeError,
  validateFiles,
} from "../services/tickets";
import type { DevApp } from "../types";
import { broadcastTicketChanges, getLiveRoom } from "../live";
import admin, { isUniqueViolation } from "./admin";
import notifications, { countUnread } from "./notifications";

const dev = new Hono<DevApp>();
dev.use("*", devAuth);
// The IT category: every ticket route and attachment needs the "it" permission.
dev.use("/tickets", need("it"));
dev.use("/tickets/*", need("it"));
dev.use("/tickets/*", broadcastTicketChanges);
dev.use("/attachments/*", need("it"));

dev.onError((err, c) => {
  if (err instanceof InputError) return c.json({ error: err.message }, 400);
  if (err instanceof TooLargeError) return c.json({ error: err.message }, 413);
  throw err;
});

const t = schema.tickets;
const PAGE_SIZE = 50;

dev.route("/admin", admin);
dev.route("/notifications", notifications);

dev.get("/live", need("it"), (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "Expected a WebSocket" }, 426);
  return getLiveRoom(c.env.LIVE).fetch(c.req.raw);
});

dev.get("/me", (c) => {
  const { id, name, email, username, role, roleName, perms, mustChangePassword } = c.get("user");
  return c.json({ user: { id, name, email, username, role, roleName, perms, mustChangePassword } });
});

// Display name and/or email; send only what changes. An empty email clears it.
// Old ticket comments keep the name they were written under.
dev.patch("/me", async (c) => {
  const me = c.get("user");
  const b = (await c.req.json().catch(() => ({}))) as { name?: unknown; email?: unknown };
  const set: { name?: string; email?: string | null } = {};
  if (b.name !== undefined) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 60) return c.json({ error: "Display name must be 1 to 60 characters" }, 400);
    set.name = name;
  }
  if (b.email !== undefined) {
    const email = (typeof b.email === "string" ? b.email.trim().toLowerCase() : "") || null;
    if (email && !EMAIL_RE.test(email)) return c.json({ error: "Enter a valid email address or leave it empty" }, 400);
    // Without a username the email is the only way to sign in.
    if (!email && !me.username) return c.json({ error: "You have no username, so your email cannot be removed" }, 400);
    set.email = email;
  }
  if (Object.keys(set).length === 0) return c.json({ error: "Nothing to change" }, 400);
  try {
    const [user] = await c.get("db")
      .update(schema.users)
      .set(set)
      .where(eq(schema.users.id, me.id))
      .returning({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        username: schema.users.username,
        role: schema.users.role,
      });
    return c.json({ user: { ...user, roleName: me.roleName, perms: me.perms } });
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: "That email is already used by another account" }, 409);
    throw e;
  }
});

dev.post("/me/password", async (c) => {
  const me = c.get("user");
  const b = (await c.req.json().catch(() => ({}))) as { current?: unknown; next?: unknown };
  const current = typeof b.current === "string" ? b.current : "";
  const next = typeof b.next === "string" ? b.next : "";
  if (!me.passwordHash || !(await verifyPassword(current, me.passwordHash))) {
    return c.json({ error: "Your current password is wrong" }, 400);
  }
  if (next.length < MIN_PASSWORD || next.length > 200) {
    return c.json({ error: `The new password needs at least ${MIN_PASSWORD} characters` }, 400);
  }
  await c.get("db")
    .update(schema.users)
    .set({ passwordHash: await hashPassword(next), mustChangePassword: 0 })
    .where(eq(schema.users.id, me.id));
  return c.json({ ok: true });
});

// Heartbeat from every open portal tab: records the page it is on (devAuth
// bumps last_seen_at at most once a minute) and returns who else is online and
// where. Tabs check in every 60s while visible; the hub calls 150s of silence
// away, and people drop off the list after 15 minutes.
// ponytail: 2 DB writes per tab per minute; carry presence over the LiveRoom
// socket (no DB at all) if tab counts grow.
const LISTED_MS = 15 * 60_000;

dev.post("/presence", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { page?: unknown };
  // Only same-site paths; the list links to them.
  const page = typeof b.page === "string" && /^\/(?!\/)/.test(b.page) ? b.page.slice(0, 200) : null;
  const db = c.get("db");
  const u = schema.users;
  await db.update(u).set({ viewingPage: page }).where(eq(u.id, c.get("user").id));
  const now = Date.now();
  const rows = await db
    .select({ id: u.id, page: u.viewingPage, lastSeenAt: u.lastSeenAt })
    .from(u)
    .where(and(eq(u.active, 1), gt(u.lastSeenAt, new Date(now - LISTED_MS).toISOString())));
  // Idle time from the server clock, so a skewed laptop clock cannot misplace anyone.
  const online = rows.map((row) => ({ id: row.id, page: row.page, idleSeconds: Math.max(0, Math.round((now - Date.parse(row.lastSeenAt!)) / 1000)) }));
  return c.json({ online });
});

// ponytail: whole table on purpose; users is bounded by IT staff headcount. Paginate if that stops being true.
dev.get("/users", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.active, 1))
    .orderBy(asc(schema.users.name));
  return c.json({ users: rows });
});

// ponytail: whole table on purpose; systems is bounded by the handful of integrated apps. Paginate if that stops being true.
dev.get("/systems", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select({ code: schema.systems.code, name: schema.systems.name, active: schema.systems.active })
    .from(schema.systems)
    .orderBy(asc(schema.systems.code));
  return c.json({ systems: rows });
});

const list = (v: string | undefined) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);

function pick<T extends string>(v: string | undefined, allowed: readonly T[]): T[] {
  return list(v).filter((x): x is T => (allowed as readonly string[]).includes(x));
}

// Every filter accepts a comma list. status: "active" = the open-ish set,
// "all" or absent = no status filter. assignee: "me", "none" or user ids.
function filterWhere(q: Record<string, string | undefined>, me: User, withStatus: boolean): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  const systems = list(q.system);
  if (systems.length) parts.push(inArray(t.systemCode, systems));
  const priorities = pick(q.priority, TICKET_PRIORITIES);
  if (priorities.length) parts.push(inArray(t.priority, priorities));
  const types = pick(q.type, TICKET_TYPES);
  if (types.length) parts.push(inArray(t.type, types));

  const assignees = list(q.assignee);
  if (assignees.length) {
    const ids = assignees.map((a) => (a === "me" ? me.id : Number(a))).filter((n) => Number.isInteger(n) && n > 0);
    parts.push(
      or(
        ids.length ? inArray(t.assigneeId, ids) : undefined,
        assignees.includes("none") ? isNull(t.assigneeId) : undefined,
      ) ?? sql`false`,
    );
  }

  // ponytail: '%term%' cannot use a btree index, so search scans the filtered set. Add a pg_trgm
  // GIN index on code, legacy_code, title and reporter_name if "All statuses" searches get slow.
  if (q.q?.trim()) {
    const term = `%${q.q.trim()}%`;
    // ilike: Postgres like is case-sensitive, and the search box should not be.
    parts.push(or(ilike(t.code, term), ilike(t.legacyCode, term), ilike(t.title, term), ilike(t.reporterName, term)));
  }
  if (withStatus && q.status && q.status !== "all") {
    const statuses = q.status === "active" ? [...ACTIVE_STATUSES] : pick(q.status, TICKET_STATUSES);
    if (statuses.length) parts.push(inArray(t.status, statuses));
  }
  return and(...parts);
}

const PRIORITY_RANK = sql`CASE ${t.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;
const STATUS_RANK = sql`CASE ${t.status} WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'on_hold' THEN 2
  WHEN 'testing' THEN 3 WHEN 'waiting_reporter' THEN 4 WHEN 'resolved' THEN 5 WHEN 'closed' THEN 6 ELSE 7 END`;

function orderFor(sort: string | undefined, dir: string | undefined) {
  const d = dir === "asc" ? asc : desc;
  switch (sort) {
    case "created":
      return [d(t.createdAt)];
    case "priority":
      return [d(PRIORITY_RANK), desc(t.updatedAt)];
    case "status":
      return [d(STATUS_RANK), desc(t.updatedAt)];
    // ponytail: no (system_code, id) index; fine while filters keep the set small.
    case "key":
      return [d(t.systemCode), d(t.id)];
    case "assignee":
      return [d(schema.users.name), desc(t.updatedAt)];
    case "updated":
      return [d(t.updatedAt)];
    // The List opens newest submitted first.
    default:
      return [d(t.createdAt)];
  }
}

dev.get("/tickets", async (c) => {
  const db = c.get("db");
  const q = c.req.query();
  const page = Math.max(1, Number(q.page) || 1);
  // 200 covers the Board; it shows "N of total" when there are more.
  const pageSize = Math.min(200, Math.max(1, Number(q.page_size) || PAGE_SIZE));
  const where = filterWhere(q, c.get("user"), true);

  const [rows, [total]] = await Promise.all([
    db
      .select({
        code: t.code,
        legacy_code: t.legacyCode,
        system_code: t.systemCode,
        type: t.type,
        priority: t.priority,
        status: t.status,
        title: t.title,
        reporter_name: t.reporterName,
        reporter_department: t.reporterDepartment,
        assignee_id: t.assigneeId,
        assignee_name: schema.users.name,
        last_public_actor: t.lastPublicActor,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
      })
      .from(t)
      .leftJoin(schema.users, eq(schema.users.id, t.assigneeId))
      .where(where)
      .orderBy(...orderFor(q.sort, q.dir))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(t).where(where),
  ]);

  return c.json({ tickets: rows, total: total?.n ?? 0, page, page_size: pageSize });
});

// Sidebar badges: active tickets per system, my active tickets, unread notifications.
dev.get("/tickets/stats", async (c) => {
  const db = c.get("db");
  const [bySystem, mine, unreadNotifications] = await Promise.all([
    db
      .select({ system: t.systemCode, n: count() })
      .from(t)
      .where(inArray(t.status, [...ACTIVE_STATUSES]))
      .groupBy(t.systemCode),
    db
      .select({ n: count() })
      .from(t)
      .where(and(eq(t.assigneeId, c.get("user").id), inArray(t.status, [...ACTIVE_STATUSES]))),
    countUnread(db, c.get("user")),
  ]);
  return c.json({
    active_by_system: Object.fromEntries(bySystem.map((r) => [r.system, r.n])),
    my_active: mine[0]?.n ?? 0,
    unread_notifications: unreadNotifications,
  });
});

async function findTicket(db: DB, code: string) {
  const [row] = await db.select().from(t).where(eq(t.code, code)).limit(1);
  return row ?? null;
}

dev.get("/tickets/:code", async (c) => {
  const db = c.get("db");
  const ticket = await findTicket(db, c.req.param("code"));
  if (!ticket) return c.json({ error: "Not found" }, 404);

  const [events, atts, [system]] = await Promise.all([
    db.select().from(schema.ticketEvents).where(eq(schema.ticketEvents.ticketId, ticket.id)).orderBy(asc(schema.ticketEvents.id)),
    db
      .select({
        id: schema.ticketAttachments.id,
        event_id: schema.ticketAttachments.eventId,
        filename: schema.ticketAttachments.filename,
        mime: schema.ticketAttachments.mime,
        size: schema.ticketAttachments.size,
      })
      .from(schema.ticketAttachments)
      .where(eq(schema.ticketAttachments.ticketId, ticket.id)),
    db.select({ name: schema.systems.name }).from(schema.systems).where(eq(schema.systems.code, ticket.systemCode)),
  ]);

  return c.json({
    ticket: { ...ticket, system_name: system?.name ?? ticket.systemCode },
    events: events.map((e) => ({ ...e, attachments: atts.filter((a) => a.event_id === e.id) })),
  });
});

type Changes = {
  status?: TicketStatus;
  priority?: Ticket["priority"];
  type?: Ticket["type"];
  assigneeId?: number | null;
};

// Writes one timeline event per changed field. Status and assignee changes are
// public (the reporter sees who is on it and where it stands); priority and
// type are triage detail and stay internal.
// ponytail: the events insert and the ticket update are two statements without a
// transaction; wrap them in db.transaction if a half-applied change is ever seen.
async function applyChanges(db: DB, ticket: Ticket, me: User, ch: Changes, at: string) {
  const patch: Partial<Ticket> = {};
  const events: (typeof schema.ticketEvents.$inferInsert)[] = [];
  const event = (kind: "assign" | "status" | "priority" | "type", visibility: "public" | "internal", fromValue: string | null, toValue: string | null) =>
    events.push({ ticketId: ticket.id, kind, visibility, authorKind: "developer", authorName: me.name, userId: me.id, fromValue, toValue, createdAt: at });
  let publicTouch = false;

  if (ch.assigneeId !== undefined && ch.assigneeId !== ticket.assigneeId) {
    // Old and new assignee names in one lookup.
    const ids = [ch.assigneeId, ticket.assigneeId].filter((id): id is number => id !== null);
    const names = new Map(
      (await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, ids))).map((u) => [u.id, u.name]),
    );
    if (ch.assigneeId !== null && !names.has(ch.assigneeId)) throw new InputError("Unknown user");
    event("assign", "public", ticket.assigneeId ? (names.get(ticket.assigneeId) ?? null) : null, ch.assigneeId ? names.get(ch.assigneeId)! : null);
    patch.assigneeId = ch.assigneeId;
    if (ch.assigneeId !== null && !ticket.pickedUpAt) patch.pickedUpAt = at;
    publicTouch = true;
  }

  if (ch.status && ch.status !== ticket.status) {
    event("status", "public", ticket.status, ch.status);
    patch.status = ch.status;
    patch.resolvedAt = ch.status === "resolved" ? at : ch.status === "closed" ? ticket.resolvedAt : null;
    patch.closedAt = ch.status === "closed" || ch.status === "rejected" ? at : null;
    publicTouch = true;
  }

  for (const field of ["priority", "type"] as const) {
    const next = ch[field];
    if (next && next !== ticket[field]) {
      event(field, "internal", ticket[field], next);
      (patch as Record<string, unknown>)[field] = next;
    }
  }

  if (events.length) await db.insert(schema.ticketEvents).values(events);
  if (publicTouch) {
    patch.lastPublicActivityAt = at;
    patch.lastPublicActor = "developer";
  }
  if (Object.keys(patch).length) {
    patch.updatedAt = at;
    await db.update(t).set(patch).where(eq(t.id, ticket.id));
  }
}

function parseChanges(f: Record<string, string | undefined>): Changes {
  const ch: Changes = {};
  if (f.status) ch.status = oneOf(f.status, TICKET_STATUSES);
  if (f.priority) ch.priority = oneOf(f.priority, TICKET_PRIORITIES);
  if (f.type) ch.type = oneOf(f.type, TICKET_TYPES);
  if (f.assignee_id !== undefined) {
    if (f.assignee_id === "" || f.assignee_id === "null") ch.assigneeId = null;
    else if (/^\d+$/.test(f.assignee_id)) ch.assigneeId = Number(f.assignee_id);
    else throw new InputError("assignee_id must be a user id or null");
  }
  return ch;
}

dev.post("/tickets/:code/pickup", async (c) => {
  const db = c.get("db");
  const me = c.get("user");
  const ticket = await findTicket(db, c.req.param("code"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  if (ticket.assigneeId && ticket.assigneeId !== me.id) {
    return c.json({ error: "Already picked up by someone else" }, 409);
  }
  if (ticket.status === "closed" || ticket.status === "rejected") {
    return c.json({ error: "Ticket is closed" }, 409);
  }
  await applyChanges(
    db,
    ticket,
    me,
    { assigneeId: me.id, status: ticket.status === "open" ? "in_progress" : undefined },
    nowIso(),
  );
  return c.json({ ok: true });
});

dev.patch("/tickets/:code", async (c) => {
  const db = c.get("db");
  const ticket = await findTicket(db, c.req.param("code"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) fields[k] = v === null ? "null" : String(v);
  await applyChanges(db, ticket, c.get("user"), parseChanges(fields), nowIso());
  return c.json({ ok: true });
});

// Comments and attachment rows go with it (ON DELETE CASCADE, migration 008).
dev.delete("/tickets/:code", need("delete_tickets"), async (c) => {
  const db = c.get("db");
  const ticket = await findTicket(db, c.req.param("code"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  const files = await db
    .select({ key: schema.ticketAttachments.r2Key })
    .from(schema.ticketAttachments)
    .where(eq(schema.ticketAttachments.ticketId, ticket.id));
  await db.delete(t).where(eq(t.id, ticket.id));
  if (files.length) await c.env.FILES.delete(files.map((f) => f.key));
  return c.json({ ok: true });
});

// Multipart: body, visibility (public|internal), files, and an optional
// status to move to in the same action (e.g. reply + Waiting Reporter).
dev.post("/tickets/:code/comments", async (c) => {
  const db = c.get("db");
  const me = c.get("user");
  const ticket = await findTicket(db, c.req.param("code"));
  if (!ticket) return c.json({ error: "Not found" }, 404);

  const { fields, files } = await readInput(c);
  validateFiles(files);
  const body = str(fields.body, 10000);
  if (!body && files.length === 0) throw new InputError("body or files required");
  const visibility = oneOf(fields.visibility, ["public", "internal"] as const, "public");

  const at = nowIso();
  const ev = await addEvent(db, ticket.id, {
    kind: "comment",
    visibility,
    authorKind: "developer",
    authorName: me.name,
    userId: me.id,
    body,
    at,
  });
  await saveAttachments(c.env, db, ticket, ev.id, files);

  if (visibility === "public") {
    await db
      .update(t)
      .set({ lastPublicActivityAt: at, lastPublicActor: "developer", updatedAt: at })
      .where(eq(t.id, ticket.id));
  } else {
    await db.update(t).set({ updatedAt: at }).where(eq(t.id, ticket.id));
  }

  const ch = parseChanges({ status: fields.status });
  if (ch.status) {
    const fresh = (await findTicket(db, ticket.code))!;
    await applyChanges(db, fresh, me, ch, at);
  }
  return c.json({ ok: true, event_id: ev.id }, 201);
});

dev.get("/attachments/:id", async (c) => {
  const db = c.get("db");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Not found" }, 404);
  const [att] = await db.select().from(schema.ticketAttachments).where(eq(schema.ticketAttachments.id, id)).limit(1);
  if (!att) return c.json({ error: "Not found" }, 404);
  return streamAttachment(c.env, att);
});

export default dev;
