import { and, asc, count, desc, eq, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema, type DB } from "../db/client";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  type Developer,
  type Ticket,
  type TicketStatus,
} from "../db/schema";
import { devAuth } from "../middleware/devAuth";
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
  validateFiles,
} from "../services/tickets";
import type { DevApp } from "../types";

const dev = new Hono<DevApp>();
dev.use("*", devAuth);

dev.onError((err, c) => {
  if (err instanceof InputError) return c.json({ error: err.message }, 400);
  throw err;
});

const t = schema.tickets;
const PAGE_SIZE = 50;

dev.get("/me", (c) => {
  const { id, name, email, username } = c.get("developer");
  return c.json({ developer: { id, name, email, username } });
});

dev.get("/developers", async (c) => {
  const db = getDb(c.env);
  const rows = await db
    .select({ id: schema.developers.id, name: schema.developers.name, email: schema.developers.email })
    .from(schema.developers)
    .where(eq(schema.developers.active, 1))
    .orderBy(asc(schema.developers.name));
  return c.json({ developers: rows });
});

dev.get("/systems", async (c) => {
  const db = getDb(c.env);
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
// "all" or absent = no status filter. assignee: "me", "none" or developer ids.
function filterWhere(q: Record<string, string | undefined>, me: Developer, withStatus: boolean): SQL | undefined {
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
      ) ?? sql`0`,
    );
  }

  if (q.q?.trim()) {
    const term = `%${q.q.trim()}%`;
    parts.push(or(like(t.code, term), like(t.legacyCode, term), like(t.title, term), like(t.reporterName, term)));
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
    case "key":
      return [d(t.systemCode), d(t.id)];
    case "assignee":
      return [d(schema.developers.name), desc(t.updatedAt)];
    default:
      return [d(t.updatedAt)];
  }
}

dev.get("/tickets", async (c) => {
  const db = getDb(c.env);
  const q = c.req.query();
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(q.page_size) || PAGE_SIZE));
  const where = filterWhere(q, c.get("developer"), true);

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
        assignee_name: schema.developers.name,
        last_public_actor: t.lastPublicActor,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
      })
      .from(t)
      .leftJoin(schema.developers, eq(schema.developers.id, t.assigneeId))
      .where(where)
      .orderBy(...orderFor(q.sort, q.dir))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(t).where(where),
  ]);

  return c.json({ tickets: rows, total: total?.n ?? 0, page, page_size: pageSize });
});

// Counts per status under the current non-status filters, plus sidebar badges.
dev.get("/tickets/stats", async (c) => {
  const db = getDb(c.env);
  const [rows, bySystem, mine] = await Promise.all([
    db
      .select({ status: t.status, n: count() })
      .from(t)
      .where(filterWhere(c.req.query(), c.get("developer"), false))
      .groupBy(t.status),
    db
      .select({ system: t.systemCode, n: count() })
      .from(t)
      .where(inArray(t.status, [...ACTIVE_STATUSES]))
      .groupBy(t.systemCode),
    db
      .select({ n: count() })
      .from(t)
      .where(and(eq(t.assigneeId, c.get("developer").id), inArray(t.status, [...ACTIVE_STATUSES]))),
  ]);
  return c.json({
    counts: Object.fromEntries(rows.map((r) => [r.status, r.n])),
    active_by_system: Object.fromEntries(bySystem.map((r) => [r.system, r.n])),
    my_active: mine[0]?.n ?? 0,
  });
});

async function findTicket(db: DB, code: string) {
  const [row] = await db.select().from(t).where(eq(t.code, code)).limit(1);
  return row ?? null;
}

dev.get("/tickets/:code", async (c) => {
  const db = getDb(c.env);
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
async function applyChanges(db: DB, ticket: Ticket, me: Developer, ch: Changes, at: string) {
  const patch: Partial<Ticket> = {};
  let publicTouch = false;

  if (ch.assigneeId !== undefined && ch.assigneeId !== ticket.assigneeId) {
    let toName: string | null = null;
    if (ch.assigneeId !== null) {
      const [d] = await db.select().from(schema.developers).where(eq(schema.developers.id, ch.assigneeId));
      if (!d) throw new InputError("Unknown developer");
      toName = d.name;
    }
    const [fromDev] = ticket.assigneeId
      ? await db.select({ name: schema.developers.name }).from(schema.developers).where(eq(schema.developers.id, ticket.assigneeId))
      : [];
    await addEvent(db, ticket.id, {
      kind: "assign",
      visibility: "public",
      authorKind: "developer",
      authorName: me.name,
      developerId: me.id,
      fromValue: fromDev?.name ?? null,
      toValue: toName,
      at,
    });
    patch.assigneeId = ch.assigneeId;
    if (ch.assigneeId !== null && !ticket.pickedUpAt) patch.pickedUpAt = at;
    publicTouch = true;
  }

  if (ch.status && ch.status !== ticket.status) {
    await addEvent(db, ticket.id, {
      kind: "status",
      visibility: "public",
      authorKind: "developer",
      authorName: me.name,
      developerId: me.id,
      fromValue: ticket.status,
      toValue: ch.status,
      at,
    });
    patch.status = ch.status;
    patch.resolvedAt = ch.status === "resolved" ? at : ch.status === "closed" ? ticket.resolvedAt : null;
    patch.closedAt = ch.status === "closed" || ch.status === "rejected" ? at : null;
    publicTouch = true;
  }

  for (const field of ["priority", "type"] as const) {
    const next = ch[field];
    if (next && next !== ticket[field]) {
      await addEvent(db, ticket.id, {
        kind: field,
        visibility: "internal",
        authorKind: "developer",
        authorName: me.name,
        developerId: me.id,
        fromValue: ticket[field],
        toValue: next,
        at,
      });
      (patch as Record<string, unknown>)[field] = next;
    }
  }

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
    else throw new InputError("assignee_id must be a developer id or null");
  }
  return ch;
}

dev.post("/tickets/:code/pickup", async (c) => {
  const db = getDb(c.env);
  const me = c.get("developer");
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
  const db = getDb(c.env);
  const ticket = await findTicket(db, c.req.param("code"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) fields[k] = v === null ? "null" : String(v);
  await applyChanges(db, ticket, c.get("developer"), parseChanges(fields), nowIso());
  return c.json({ ok: true });
});

// Multipart: body, visibility (public|internal), files, and an optional
// status to move to in the same action (e.g. reply + Waiting Reporter).
dev.post("/tickets/:code/comments", async (c) => {
  const db = getDb(c.env);
  const me = c.get("developer");
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
    developerId: me.id,
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
  const db = getDb(c.env);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Not found" }, 404);
  const [att] = await db.select().from(schema.ticketAttachments).where(eq(schema.ticketAttachments.id, id)).limit(1);
  if (!att) return c.json({ error: "Not found" }, 404);
  return streamAttachment(c.env, att);
});

export default dev;
