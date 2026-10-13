import { integer, pgTable, text } from "drizzle-orm/pg-core";

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
});

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

export type Ticket = typeof tickets.$inferSelect;
export type TicketEvent = typeof ticketEvents.$inferSelect;
export type TicketAttachment = typeof ticketAttachments.$inferSelect;
export type User = typeof users.$inferSelect;
