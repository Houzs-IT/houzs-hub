import { eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { schema, type DB } from "../db/client";
import type { AuthorKind, EventKind, Ticket, Visibility } from "../db/schema";
import type { Env } from "../types";

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = /^(image\/|video\/mp4$|video\/quicktime$|application\/pdf$)/;

export const nowIso = () => new Date().toISOString();

export class InputError extends Error {}

export type Input = { fields: Record<string, string>; files: File[] };

// Systems may send JSON (no files) or multipart (fields + `files`).
export async function readInput(c: Context): Promise<Input> {
  const ct = c.req.header("Content-Type") ?? "";
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
    if (!ALLOWED_MIME.test(f.type)) throw new InputError(`${f.name}: only images, mp4/mov or pdf`);
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
    developerId?: number | null;
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
      developerId: e.developerId ?? null,
      body: e.body ?? null,
      fromValue: e.fromValue ?? null,
      toValue: e.toValue ?? null,
      createdAt: e.at ?? nowIso(),
    })
    .returning();
  return row;
}

export async function saveAttachments(env: Env, db: DB, ticket: Ticket, eventId: number, files: File[]) {
  const at = nowIso();
  for (const f of files) {
    const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
    const key = `tickets/${ticket.code}/${crypto.randomUUID()}-${safe}`;
    await env.FILES.put(key, f.stream(), { httpMetadata: { contentType: f.type } });
    await db.insert(schema.ticketAttachments).values({
      ticketId: ticket.id,
      eventId,
      r2Key: key,
      filename: f.name.slice(0, 200),
      mime: f.type,
      size: f.size,
      createdAt: at,
    });
  }
}

export async function streamAttachment(env: Env, att: { r2Key: string; mime: string; filename: string }) {
  const obj = await env.FILES.get(att.r2Key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": att.mime,
      "Content-Disposition": `inline; filename="${att.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export const ACTIVE_STATUSES = ["open", "in_progress", "on_hold", "testing", "waiting_reporter"] as const;
