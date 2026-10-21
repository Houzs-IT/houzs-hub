import { integer, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

export const TICKET_TYPES = ["bug", "development"] as const;
export const TICKET_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "on_hold",
  "testing",
  "waiting_reporter",
  "resolved",
  "closed",
  "rejected",
] as const;

export type TicketType = (typeof TICKET_TYPES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type Visibility = "public" | "internal";
export type AuthorKind = "reporter" | "developer" | "system";
export type EventKind = "created" | "comment" | "status" | "assign" | "priority" | "type";

const id = () => integer("id").primaryKey().generatedByDefaultAsIdentity();

export const systems = pgTable("systems", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  apiKeyHash: text("api_key_hash"),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  lastCallAt: text("last_call_at"),
  lastSendError: text("last_send_error"),
  lastSendErrorAt: text("last_send_error_at"),
});

export const ticketSequences = pgTable("ticket_sequences", {
  systemCode: text("system_code").primaryKey(),
  nextN: integer("next_n").notNull(),
});

export const users = pgTable("users", {
  id: id(),
  email: text("email"),
  name: text("name").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at"),
  lastSeenAt: text("last_seen_at"),
  username: text("username"),
  passwordHash: text("password_hash"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: text("locked_until"),
  // A roles.key. See services/perms.ts for how permissions are worked out.
  role: text("role").notNull().default("developer"),
  mustChangePassword: integer("must_change_password").notNull().default(0),
  viewingPage: text("viewing_page"),
  permAllow: text("perm_allow").notNull().default(""),
  permDeny: text("perm_deny").notNull().default(""),
  notificationsSeenId: integer("notifications_seen_id"),
});

// Notifications read one by one above users.notificationsSeenId.
export const notificationReads = pgTable(
  "notification_reads",
  {
    userId: integer("user_id").notNull(),
    eventId: integer("event_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.eventId] })],
);

export const roles = pgTable("roles", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  permissions: text("permissions").notNull().default(""),
  createdAt: text("created_at"),
});

export const tickets = pgTable("tickets", {
  id: id(),
  code: text("code").notNull(),
  legacyCode: text("legacy_code"),
  systemCode: text("system_code").notNull(),
  type: text("type").$type<TicketType>().notNull(),
  priority: text("priority").$type<TicketPriority>().notNull(),
  status: text("status").$type<TicketStatus>().notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  occurredAt: text("occurred_at"),
  reporterExternalId: text("reporter_external_id").notNull(),
  reporterName: text("reporter_name").notNull(),
  reporterEmail: text("reporter_email"),
  reporterPhone: text("reporter_phone"),
  reporterDepartment: text("reporter_department"),
  pageUrl: text("page_url"),
  userAgent: text("user_agent"),
  appVersion: text("app_version"),
  assigneeId: integer("assignee_id"),
  pickedUpAt: text("picked_up_at"),
  resolvedAt: text("resolved_at"),
  closedAt: text("closed_at"),
  lastPublicActivityAt: text("last_public_activity_at").notNull(),
  lastPublicActor: text("last_public_actor").$type<AuthorKind>().notNull(),
  reporterSeenAt: text("reporter_seen_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  boardRank: integer("board_rank"),
});

export const ticketEvents = pgTable("ticket_events", {
  id: id(),
  ticketId: integer("ticket_id").notNull(),
  kind: text("kind").$type<EventKind>().notNull(),
  visibility: text("visibility").$type<Visibility>().notNull(),
  authorKind: text("author_kind").$type<AuthorKind>().notNull(),
  authorName: text("author_name").notNull(),
  userId: integer("user_id"),
  body: text("body"),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  createdAt: text("created_at").notNull(),
  editedAt: text("edited_at"),
});

export const ticketAttachments = pgTable("ticket_attachments", {
  id: id(),
  ticketId: integer("ticket_id").notNull(),
  eventId: integer("event_id").notNull(),
  r2Key: text("r2_key").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  createdAt: text("created_at").notNull(),
});

// System health: what the hub checks, and the results (7 days kept).
export const healthTargets = pgTable("health_targets", {
  id: id(),
  name: text("name").notNull(),
  systemCode: text("system_code"),
  checkUrl: text("check_url").notNull(),
  pageUrl: text("page_url").notNull().default(""),
  sort: integer("sort").notNull().default(0),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

export const healthChecks = pgTable("health_checks", {
  id: id(),
  targetId: integer("target_id").notNull(),
  checkedAt: text("checked_at").notNull(),
  ok: integer("ok").notNull(),
  status: integer("status"),
  ms: integer("ms"),
  version: text("version"),
  error: text("error"),
});

// A system's own health report, sent with its hub key (see routes/sysHealth.ts).
export const healthReports = pgTable("health_reports", {
  id: id(),
  systemCode: text("system_code").notNull(),
  receivedAt: text("received_at").notNull(),
  ok: integer("ok").notNull(),
  report: jsonb("report").$type<HealthReport>().notNull(),
});

export type HealthStatus = "ok" | "warning" | "critical" | "off";
export type HealthReport = {
  ok: boolean;
  time: string | null;
  db: { ok: boolean; latency_ms: number | null; error?: string } | null;
  storage: { bound: boolean; ok: boolean; latency_ms: number | null } | null;
  counts: Record<string, number | string | null>;
  checks: { key: string; label: string; value: string; status: HealthStatus; summary: string; detail?: string }[];
  problems: { at: string; what: string; where?: string | null; error?: string | null }[];
};

export type Ticket = typeof tickets.$inferSelect;
export type TicketEvent = typeof ticketEvents.$inferSelect;
export type TicketAttachment = typeof ticketAttachments.$inferSelect;
export type User = typeof users.$inferSelect;
