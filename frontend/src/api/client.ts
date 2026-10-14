export type Status = "open" | "in_progress" | "on_hold" | "testing" | "waiting_reporter" | "resolved" | "closed" | "rejected";
export type Priority = "urgent" | "high" | "medium" | "low";
export type TicketType = "bug" | "development";

// Permission keys come from the server (services/perms.ts); these are the ones
// the portal checks to show or hide things.
export type Perm = "it" | "delete_tickets" | "users" | "roles" | "integrations";
export type User = {
  id: number;
  name: string;
  email: string | null;
  username?: string | null;
  role?: string;
  roleName?: string;
  perms?: Perm[];
  mustChangePassword?: number;
};
export type PermDef = { key: Perm; label: string; hint: string };
export type RoleRow = { key: string; name: string; permissions: Perm[]; users: number; builtIn: boolean };
export type SystemRow = { code: string; name: string; active: number };

export type TicketRow = {
  code: string;
  legacy_code: string | null;
  system_code: string;
  type: TicketType;
  priority: Priority;
  status: Status;
  title: string;
  reporter_name: string;
  reporter_department: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  last_public_actor: "reporter" | "developer" | "system";
  created_at: string;
  updated_at: string;
};

export type Notification = {
  id: number;
  kind: "created" | "comment" | "status";
  visibility: "public" | "internal";
  author_name: string;
  body: string | null;
  to_value: string | null;
  created_at: string;
  ticket_code: string;
  ticket_title: string;
};

export type NotificationsResponse = {
  notifications: Notification[];
  total: number;
  // The server stops counting at 1001; show "1000+".
  total_capped: boolean;
  page: number;
  page_size: number;
  seen_id: number;
};

export type Attachment = { id: number; event_id: number; filename: string; mime: string; size: number };

export type TicketEvent = {
  id: number;
  kind: "created" | "comment" | "status" | "assign" | "priority" | "type";
  visibility: "public" | "internal";
  authorKind: "reporter" | "developer" | "system";
  authorName: string;
  body: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
  attachments: Attachment[];
};

export type TicketFull = {
  id: number;
  code: string;
  legacyCode: string | null;
  systemCode: string;
  system_name: string;
  type: TicketType;
  priority: Priority;
  status: Status;
  title: string;
  description: string;
  occurredAt: string | null;
  reporterExternalId: string;
  reporterName: string;
  reporterEmail: string | null;
  reporterPhone: string | null;
  reporterDepartment: string | null;
  pageUrl: string | null;
  userAgent: string | null;
  appVersion: string | null;
  assigneeId: number | null;
  pickedUpAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  lastPublicActor: "reporter" | "developer" | "system";
  createdAt: string;
  updatedAt: string;
};

const BASE = "/api/v1/dev";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { credentials: "same-origin", ...init });
  // Every page and poll goes through here, so this is the one place an expired
  // session sends the user back to the login page.
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (res.status === 401) {
    const reason = data.code === "account_disabled" ? "&disabled=1" : "";
    location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}${reason}`);
    return new Promise<T>(() => {});
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const attachmentUrl = (id: number) => `${BASE}/attachments/${id}`;
