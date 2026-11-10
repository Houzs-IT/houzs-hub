import { eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { schema, type DB } from "../db/client";
import { TICKET_PRIORITIES, TICKET_TYPES, type AuthorKind, type EventKind, type Ticket, type Visibility } from "../db/schema";
import { getLiveRoom } from "../live";
import type { Env } from "../types";

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
// Any file type is accepted, so only these open in the browser; the rest download, which keeps an uploaded
// .html or .svg from running script on the hub's own origin.
const INLINE_MIME = /^(image\/(png|jpeg|gif|webp|bmp|heic|heif)|video\/mp4|video\/quicktime|application\/pdf)$/;
// Browsers label a .zip as application/zip, application/x-zip-compressed (Windows) or nothing at all.
const isZip = (f: File) => f.name.toLowerCase().endsWith(".zip");
const mimeOf = (f: File) => (isZip(f) ? "application/zip" : f.type || "application/octet-stream");

export const nowIso = () => new Date().toISOString();

export class InputError extends Error {}
export class TooLargeError extends Error {}

// Room for the largest legal upload plus the text fields around it.
const MAX_BODY_BYTES = MAX_FILES * MAX_FILE_BYTES + 1024 * 1024;

export type Input = { fields: Record<string, string>; files: File[] };

// Systems may send JSON (no files) or multipart (fields + `files`).
export async function readInput(c: Context): Promise<Input> {
  const ct = c.req.header("Content-Type") ?? "";
  // formData() buffers the whole body, so refuse oversized ones before reading.
  // Chunked uploads carry no Content-Length; validateFiles still caps those.
  if (Number(c.req.header("Content-Length")) > MAX_BODY_BYTES) throw new TooLargeError("Upload is too large (5 files, 10 MB each)");
  if (ct.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const fields: Record<string, string> = {};
    const files: File[] = [];
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") fields[k] = v;
      else if (k === "files" && v.size > 0) files.push(v);
    }
    return { fields, files };
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) if (v != null) fields[k] = String(v);
  return { fields, files: [] };
}

export function validateFiles(files: File[]) {
  if (files.length > MAX_FILES) throw new InputError(`At most ${MAX_FILES} files`);
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) throw new InputError(`${f.name} is larger than 10 MB`);
  }
}

export function str(v: string | undefined, max: number): string | null {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
}

export function oneOf<T extends string>(v: string | undefined, allowed: readonly T[], fallback?: T): T {
  if (v && (allowed as readonly string[]).includes(v)) return v as T;
  if (fallback !== undefined && !v) return fallback;
  throw new InputError(`Must be one of: ${allowed.join(", ")}`);
}

export async function nextTicketCode(db: DB, systemCode: string): Promise<string> {
  const [row] = await db
    .update(schema.ticketSequences)
    .set({ nextN: sql`${schema.ticketSequences.nextN} + 1` })
    .where(eq(schema.ticketSequences.systemCode, systemCode))
    .returning({ next: schema.ticketSequences.nextN });
  if (!row) throw new Error(`No sequence for system ${systemCode}`);
  return `${systemCode}-${String(row.next - 1).padStart(4, "0")}`;
}

export async function addEvent(
  db: DB,
  ticketId: number,
  e: {
    kind: EventKind;
    visibility: Visibility;
    authorKind: AuthorKind;
    authorName: string;
    userId?: number | null;
    body?: string | null;
    fromValue?: string | null;
    toValue?: string | null;
    at?: string;
  },
) {
  const [row] = await db
    .insert(schema.ticketEvents)
    .values({
      ticketId,
      kind: e.kind,
      visibility: e.visibility,
      authorKind: e.authorKind,
      authorName: e.authorName,
      userId: e.userId ?? null,
      body: e.body ?? null,
      fromValue: e.fromValue ?? null,
      toValue: e.toValue ?? null,
      createdAt: e.at ?? nowIso(),
    })
    .returning();
  return row;
}

export async function saveAttachments(env: Env, db: DB, ticket: Ticket, eventId: number, files: File[]) {
  if (!files.length) return;
  const at = nowIso();
  const rows = await Promise.all(
    files.map(async (f) => {
      const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
      const key = `tickets/${ticket.code}/${crypto.randomUUID()}-${safe}`;
      await env.FILES.put(key, f.stream(), { httpMetadata: { contentType: mimeOf(f) } });
      return { ticketId: ticket.id, eventId, r2Key: key, filename: f.name.slice(0, 200), mime: mimeOf(f), size: f.size, createdAt: at };
    }),
  );
  await db.insert(schema.ticketAttachments).values(rows);
}

function byteSpan(range: R2Range, size: number): { start: number; end: number } {
  if ("suffix" in range) return { start: Math.max(0, size - range.suffix), end: size - 1 };
  const start = range.offset ?? 0;
  const end = range.length === undefined ? size - 1 : Math.min(size - 1, start + range.length - 1);
  return { start, end };
}

// The video player seeks with Range requests; without a 206 reply browsers cannot jump ahead.
export async function streamAttachment(env: Env, att: { r2Key: string; mime: string; filename: string }, requestHeaders: Headers) {
  const isRangeRequest = requestHeaders.has("Range");
  const obj = await env.FILES.get(att.r2Key, isRangeRequest ? { range: requestHeaders } : undefined);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": att.mime,
    "Content-Disposition": `${INLINE_MIME.test(att.mime) ? "inline" : "attachment"}; filename="${att.filename.replace(/"/g, "")}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  });
  if (!isRangeRequest || !obj.range) {
    headers.set("Content-Length", String(obj.size));
    return new Response(obj.body, { headers });
  }
  const { start, end } = byteSpan(obj.range, obj.size);
  headers.set("Content-Range", `bytes ${start}-${end}/${obj.size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(obj.body, { status: 206, headers });
}

export interface TicketCreator {
  authorKind: AuthorKind;
  authorName: string;
  userId: number | null;
}

export interface NewTicketInput {
  systemCode: string;
  reporterExternalId: string;
  createdBy: TicketCreator;
  fields: Record<string, string>;
  files: File[];
}

export async function createTicket(env: Env, db: DB, input: NewTicketInput): Promise<Ticket> {
  const { systemCode, reporterExternalId, createdBy, fields, files } = input;
  validateFiles(files);
  const title = str(fields.title, 200);
  const reporterName = str(fields.reporter_name, 120);
  if (!title) throw new InputError("title is required");
  if (!reporterName) throw new InputError("reporter_name is required");

  const now = nowIso();
  const code = await nextTicketCode(db, systemCode);
  const [ticket] = await db
    .insert(schema.tickets)
    .values({
      code,
      systemCode,
      type: oneOf(fields.type, TICKET_TYPES, "bug"),
      // Urgent was dropped; a system still on an older build may send it.
      priority: oneOf(fields.priority === "urgent" ? "high" : fields.priority, TICKET_PRIORITIES, "medium"),
      status: "open",
      title,
      description: str(fields.description, 10000) ?? "",
      // Reporters rarely say when it happened; submission time is the best guess.
      occurredAt: str(fields.occurred_at, 40) ?? now,
      reporterExternalId,
      reporterName,
      reporterEmail: str(fields.reporter_email, 200),
      reporterPhone: str(fields.reporter_phone, 40),
      reporterDepartment: str(fields.reporter_department, 120),
      pageUrl: str(fields.page_url, 1000),
      module: str(fields.module, 60),
      userAgent: str(fields.user_agent, 500),
      appVersion: str(fields.app_version, 60),
      lastPublicActivityAt: now,
      lastPublicActor: createdBy.authorKind,
      reporterSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const createdEvent = await addEvent(db, ticket.id, { kind: "created", visibility: "public", ...createdBy, at: now });
  await saveAttachments(env, db, ticket, createdEvent.id, files);
  return ticket;
}

export async function announceNewTicket(env: Env, ticket: Ticket): Promise<void> {
  // Same shape as a row of GET /dev/tickets.
  const ticketRow = {
    code: ticket.code,
    legacy_code: ticket.legacyCode,
    system_code: ticket.systemCode,
    type: ticket.type,
    priority: ticket.priority,
    status: ticket.status,
    title: ticket.title,
    reporter_name: ticket.reporterName,
    reporter_department: ticket.reporterDepartment,
    assignee_id: null,
    assignee_name: null,
    last_public_actor: ticket.lastPublicActor,
    created_at: ticket.createdAt,
    updated_at: ticket.updatedAt,
  };
  await getLiveRoom(env.LIVE).broadcast(JSON.stringify({ type: "ticket.created", ticket: ticketRow }));
}

export const ACTIVE_STATUSES =["open", "in_progress", "on_hold", "testing", "waiting_reporter"] as const;
