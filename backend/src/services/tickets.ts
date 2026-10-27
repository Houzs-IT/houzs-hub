import { eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { schema, type DB } from "../db/client";
import type { AuthorKind, EventKind, Ticket, Visibility } from "../db/schema";
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

export async function streamAttachment(env: Env, att: { r2Key: string; mime: string; filename: string }) {
  const obj = await env.FILES.get(att.r2Key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": att.mime,
      "Content-Disposition": `${INLINE_MIME.test(att.mime) ? "inline" : "attachment"}; filename="${att.filename.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export const ACTIVE_STATUSES = ["open", "in_progress", "on_hold", "testing", "waiting_reporter"] as const;
