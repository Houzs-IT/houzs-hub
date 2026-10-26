import { integer, jsonb, numeric, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

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

export const ACCOUNT_STATUSES = ["yes", "partly", "not_yet", "cant_move"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

// Outside accounts and who controls them. Never passwords, keys or card numbers.
export const accounts = pgTable("accounts", {
  id: id(),
  name: text("name").notNull(),
  companies: text("companies").notNull().default(""),
  vendor: text("vendor").notNull().default(""),
  mainOwner: text("main_owner").notNull().default(""),
  control: text("control").notNull().default(""),
  itAccess: text("it_access").notNull().default(""),
  status: text("status").$type<AccountStatus>().notNull().default("not_yet"),
  billsTo: text("bills_to").notNull().default(""),
  registerIds: text("register_ids").notNull().default(""),
  nextStep: text("next_step").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

// Company cards, last 4 digits only.
export const cards = pgTable("cards", {
  id: id(),
  nickname: text("nickname").notNull(),
  last4: text("last4").notNull().default(""),
  bank: text("bank").notNull().default(""),
  holder: text("holder").notNull().default(""),
  company: text("company").notNull().default(""),
  statementDay: integer("statement_day"),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

export const CHARGE_STATUSES = ["confirmed", "to_confirm", "to_fill_in", "not_active", "cancelled"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];
export const CHARGE_BILLED = ["", "monthly", "yearly", "credit", "usage"] as const;
export const CURRENCIES = ["USD", "MYR"] as const;
// The systems a bill can belong to. Same list as the CHECKs in 008_billing_systems.sql.
export const BILLING_SYSTEMS = [
  ["CONTS", "Conts ERP"],
  ["HC", "Houzs ERP"],
  ["HK", "Hookka"],
  ["CONNECT", "Houzs Connect"],
  ["2990", "2990s"],
  ["HUB", "IT Hub"],
] as const;
export const BILLING_SYSTEM_CODES: readonly string[] = BILLING_SYSTEMS.map(([code]) => code);

// One bill line per row, like a row of the sheet's Register tab.
export const charges = pgTable("charges", {
  id: id(),
  registerId: text("register_id").notNull().default(""),
  accountId: integer("account_id"),
  company: text("company").notNull().default(""),
  // The sheet's free-text System, kept for reference; systemCode is what counts.
  system: text("system").notNull().default(""),
  systemCode: text("system_code").notNull().default(""),
  projectRef: text("project_ref").notNull().default(""),
  module: text("module").notNull().default(""),
  vendor: text("vendor").notNull(),
  serviceType: text("service_type").notNull().default(""),
  usedFor: text("used_for").notNull().default(""),
  plan: text("plan").notNull().default(""),
  // numeric comes back from Postgres as a string; the API turns it into a number.
  amount: numeric("amount", { precision: 12, scale: 2 }),
  currency: text("currency").notNull().default("USD"),
  billed: text("billed").notNull().default(""),
  card: text("card").notNull().default(""),
  status: text("status").$type<ChargeStatus>().notNull().default("to_confirm"),
  checkedOn: text("checked_on"),
  keyName: text("key_name").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

// A shared charge's share per system, in percent; the rows add up to 100.
export const chargeSplits = pgTable(
  "charge_splits",
  {
    chargeId: integer("charge_id").notNull(),
    systemCode: text("system_code").notNull(),
    percent: numeric("percent", { precision: 5, scale: 2 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.chargeId, table.systemCode] })],
);

// Card statement lines in ringgit, tied to a charge by its sheet ID.
export const statementLines = pgTable("statement_lines", {
  id: id(),
  txnDate: text("txn_date").notNull(),
  card: text("card").notNull().default(""),
  description: text("description").notNull().default(""),
  registerId: text("register_id").notNull().default(""),
  amountMyr: numeric("amount_myr", { precision: 12, scale: 2 }).notNull(),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by"),
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
  // When the running version of the system was published (optional; The Conts sends it).
  published_at: string | null;
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
