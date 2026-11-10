import { and, asc, count, desc, eq, inArray, isNull, or, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "../db/client";
import { TICKET_STATUSES, type Ticket } from "../db/schema";
import { broadcastTicketChanges } from "../live";
import { systemAuth } from "../middleware/systemAuth";
import {
  InputError,
  addEvent,
  announceNewTicket,
  createTicket,
  nowIso,
  readInput,
  saveAttachments,
  str,
  streamAttachment,
  TooLargeError,
  validateFiles,
} from "../services/tickets";
import type { SysApp } from "../types";

// API for the reporting systems (Hookka, Houzs Century, ...). Every call is
// scoped to the calling system + X-Reporter-Id; a reporter only ever sees
// their own tickets and only public events.
const sys = new Hono<SysApp>();
sys.use("*", systemAuth);
sys.use("/tickets/:code/*", broadcastTicketChanges);

sys.onError(async (err, c) => {
  // A failed ticket send shows on the Integrations page until the next good one.
  const systemCode = c.get("systemCode");
  if (systemCode && c.req.method === "POST" && c.req.path.endsWith("/tickets")) {
    await getDb(c.env)
      .update(schema.systems)
      .set({ lastSendError: err.message.slice(0, 300), lastSendErrorAt: nowIso() })
      .where(eq(schema.systems.code, systemCode))
      .catch((e) => console.error("could not record send error", e));
  }
  if (err instanceof InputError) return c.json({ error: err.message }, 400);
  if (err instanceof TooLargeError) return c.json({ error: err.message }, 413);
  throw err;
});

const t = schema.tickets;

const unreadExpr = sql<number>`CASE WHEN ${t.lastPublicActor} = 'developer'
  AND (${t.reporterSeenAt} IS NULL OR ${t.lastPublicActivityAt} > ${t.reporterSeenAt}) THEN 1 ELSE 0 END`;

function publicTicket(row: Ticket, assigneeName: string | null) {
  return {
    code: row.code,
    type: row.type,
    priority: row.priority,
    status: row.status,
    title: row.title,
    description: row.description,
    occurred_at: row.occurredAt,
    page_url: row.pageUrl,
    assignee_name: assigneeName,
    picked_up_at: row.pickedUpAt,
    resolved_at: row.resolvedAt,
    closed_at: row.closedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function ownTicket(c: { get: (k: "systemCode" | "reporterId") => string }, db: ReturnType<typeof getDb>, code: string) {
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.code, code), eq(t.systemCode, c.get("systemCode")), eq(t.reporterExternalId, c.get("reporterId"))))
    .limit(1);
  return row ?? null;
}

sys.post("/tickets", async (c) => {
  const db = getDb(c.env);
  const { fields, files } = await readInput(c);
  const systemCode = c.get("systemCode");
  const ticket = await createTicket(c.env, db, {
    systemCode,
    reporterExternalId: c.get("reporterId"),
    createdBy: { authorKind: "reporter", authorName: str(fields.reporter_name, 120) ?? "", userId: null },
    fields,
    files,
  });
  await db
    .update(schema.systems)
    .set({ lastSendError: null, lastSendErrorAt: null })
    .where(eq(schema.systems.code, systemCode));
  c.executionCtx.waitUntil(announceNewTicket(c.env, ticket));

  return c.json({ code: ticket.code, status: ticket.status, created_at: ticket.createdAt }, 201);
});

sys.get("/tickets", async (c) => {
  const db = getDb(c.env);
  const status = c.req.query("status");
  const statuses = status ? status.split(",").filter((s) => (TICKET_STATUSES as readonly string[]).includes(s)) : [];

  const where = and(
    eq(t.systemCode, c.get("systemCode")),
    eq(t.reporterExternalId, c.get("reporterId")),
    statuses.length ? inArray(t.status, statuses as Ticket["status"][]) : undefined,
  );
  // Optional paging. Without page / page_size it still returns the newest 200, as systems already expect.
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(c.req.query("page_size")) || 200));

  const [rows, [total]] = await Promise.all([
    db
      .select({
        code: t.code,
        type: t.type,
        priority: t.priority,
        status: t.status,
        title: t.title,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        assignee_name: schema.users.name,
        unread: unreadExpr,
      })
      .from(t)
      .leftJoin(schema.users, eq(schema.users.id, t.assigneeId))
      .where(where)
      .orderBy(desc(t.updatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(t).where(where),
  ]);

  return c.json({ tickets: rows.map((r) => ({ ...r, unread: r.unread === 1 })), total: total?.n ?? 0, page, page_size: pageSize });
});

sys.get("/tickets/unread-count", async (c) => {
  const db = getDb(c.env);
  const [row] = await db
    .select({ n: count() })
    .from(t)
    .where(
      and(
        eq(t.systemCode, c.get("systemCode")),
        eq(t.reporterExternalId, c.get("reporterId")),
        eq(t.lastPublicActor, "developer"),
        or(isNull(t.reporterSeenAt), gt(t.lastPublicActivityAt, t.reporterSeenAt)),
      ),
    );
  return c.json({ unread: row?.n ?? 0 });
});

sys.get("/tickets/:code", async (c) => {
  const db = getDb(c.env);
  const ticket = await ownTicket(c, db, c.req.param("code"));
  if (!ticket) return c.json({ error: "Not found" }, 404);

  const [assignee] = ticket.assigneeId
    ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, ticket.assigneeId))
    : [];

  const events = await db
    .select()
    .from(schema.ticketEvents)
    .where(and(eq(schema.ticketEvents.ticketId, ticket.id), eq(schema.ticketEvents.visibility, "public")))
    .orderBy(asc(schema.ticketEvents.id));

  const eventIds = events.map((e) => e.id);
  const atts = eventIds.length
    ? await db
        .select({
          id: schema.ticketAttachments.id,
          event_id: schema.ticketAttachments.eventId,
          filename: schema.ticketAttachments.filename,
          mime: schema.ticketAttachments.mime,
          size: schema.ticketAttachments.size,
        })
        .from(schema.ticketAttachments)
        .where(inArray(schema.ticketAttachments.eventId, eventIds))
    : [];

  await db.update(t).set({ reporterSeenAt: nowIso() }).where(eq(t.id, ticket.id));

  return c.json({
    ticket: publicTicket(ticket, assignee?.name ?? null),
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      author_kind: e.authorKind,
      author_name: e.authorName,
      body: e.body,
      from_value: e.fromValue,
      to_value: e.toValue,
      created_at: e.createdAt,
      edited_at: e.editedAt,
      attachments: atts.filter((a) => a.event_id === e.id),
    })),
  });
});

sys.post("/tickets/:code/replies", async (c) => {
  const db = getDb(c.env);
  const ticket = await ownTicket(c, db, c.req.param("code"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  if (ticket.status === "closed" || ticket.status === "rejected") {
    return c.json({ error: "Ticket is closed. Please open a new one." }, 409);
  }

  const { fields, files } = await readInput(c);
  validateFiles(files);
  const body = str(fields.body, 10000);
  if (!body && files.length === 0) throw new InputError("body or files required");

  const now = nowIso();
  const ev = await addEvent(db, ticket.id, {
    kind: "comment",
    visibility: "public",
    authorKind: "reporter",
    authorName: ticket.reporterName,
    body,
    at: now,
  });
  await saveAttachments(c.env, db, ticket, ev.id, files);

  // A reply on Waiting Reporter means the ball is back with dev. Done stays Done; dev decides what happens next.
  let status = ticket.status;
  if (status === "waiting_reporter") {
    status = "in_progress";
    await addEvent(db, ticket.id, {
      kind: "status",
      visibility: "public",
      authorKind: "system",
      authorName: "System",
      fromValue: ticket.status,
      toValue: status,
      at: now,
    });
  }

  await db
    .update(t)
    .set({
      status,
      resolvedAt: status === "in_progress" ? null : ticket.resolvedAt,
      lastPublicActivityAt: now,
      lastPublicActor: "reporter",
      reporterSeenAt: now,
      updatedAt: now,
    })
    .where(eq(t.id, ticket.id));

  return c.json({ ok: true, status }, 201);
});

sys.post("/tickets/:code/confirm", async (c) => {
  const db = getDb(c.env);
  const ticket = await ownTicket(c, db, c.req.param("code"));
  if (!ticket) return c.json({ error: "Not found" }, 404);
  if (ticket.status !== "resolved") return c.json({ error: "Only a resolved ticket can be confirmed" }, 409);

  const now = nowIso();
  await addEvent(db, ticket.id, {
    kind: "status",
    visibility: "public",
    authorKind: "reporter",
    authorName: ticket.reporterName,
    fromValue: "resolved",
    toValue: "closed",
    at: now,
  });
  await db
    .update(t)
    .set({
      status: "closed",
      closedAt: now,
      lastPublicActivityAt: now,
      lastPublicActor: "reporter",
      reporterSeenAt: now,
      updatedAt: now,
    })
    .where(eq(t.id, ticket.id));
  return c.json({ ok: true, status: "closed" });
});

sys.get("/attachments/:id", async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "Not found" }, 404);
  const [att] = await db
    .select({ r2Key: schema.ticketAttachments.r2Key, mime: schema.ticketAttachments.mime, filename: schema.ticketAttachments.filename })
    .from(schema.ticketAttachments)
    .innerJoin(t, eq(t.id, schema.ticketAttachments.ticketId))
    .innerJoin(schema.ticketEvents, eq(schema.ticketEvents.id, schema.ticketAttachments.eventId))
    .where(
      and(
        eq(schema.ticketAttachments.id, id),
        eq(t.systemCode, c.get("systemCode")),
        eq(t.reporterExternalId, c.get("reporterId")),
        eq(schema.ticketEvents.visibility, "public"),
      ),
    )
    .limit(1);
  if (!att) return c.json({ error: "Not found" }, 404);
  return streamAttachment(c.env, att, c.req.raw.headers);
});

export default sys;
