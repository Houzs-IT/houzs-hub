export type Status = "open" | "in_progress" | "on_hold" | "testing" | "waiting_reporter" | "resolved" | "closed" | "rejected";
export type Priority = "high" | "medium" | "low";
export type TicketType = "bug" | "development";

// Permission keys come from the server (services/perms.ts); these are the ones
// the portal checks to show or hide things.
export type Perm =
  | "it"
  | "notifications"
  | "delete_tickets"
  | "users"
  | "roles"
  | "integrations"
  | "accounts_view"
  | "accounts_edit"
  | "billing_view"
  | "billing_edit"
  | "health_view"
  | "health_edit";

export type ChargeStatus = "confirmed" | "to_confirm" | "to_fill_in" | "not_active" | "cancelled";
export type ChargeRow = {
  id: number;
  registerId: string;
  accountId: number | null;
  company: string;
  system: string;
  systemCode: string;
  projectRef: string;
  module: string;
  splitByUsage: number;
  splits: { systemCode: string; percent: number }[];
  vendor: string;
  serviceType: string;
  usedFor: string;
  plan: string;
  amount: number | null;
  currency: "USD" | "MYR";
  billed: "" | "monthly" | "yearly" | "credit" | "usage";
  card: string;
  status: ChargeStatus;
  checkedOn: string | null;
  keyName: string;
  notes: string;
  updatedAt: string;
  updatedBy: string | null;
};
export type CardRow = {
  id: number;
  nickname: string;
  last4: string;
  bank: string;
  holder: string;
  company: string;
  statementDay: number | null;
  notes: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type StatementLine = {
  id: number;
  txnDate: string;
  card: string;
  description: string;
  registerId: string;
  amountMyr: number;
  notes: string;
  checkedByHand: number;
  updatedAt: string;
  updatedBy: string | null;
};
export type InvoiceRow = {
  id: number;
  vendor: string;
  invoiceNo: string;
  invoiceDate: string;
  periodFrom: string | null;
  periodTo: string | null;
  billTo: string;
  total: number;
  currency: "USD" | "MYR";
  chargeId: number | null;
  statementLineId: number | null;
  fileKey: string | null;
  fileName: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};
export type InvoiceLineRow = {
  id: number;
  invoiceId: number;
  description: string;
  projectRef: string;
  amount: number;
  kind: "charge" | "tax" | "discount" | "rounding";
};
export type ProjectRef = { ref: string; vendor: string; name: string; chargeId: number | null; inUse: number; updatedAt: string; updatedBy: string | null };
export type BillingData = {
  charges: ChargeRow[];
  systems: { code: string; name: string }[];
  cards: CardRow[];
  accounts: { id: number; name: string }[];
  lines: StatementLine[];
  invoices: InvoiceRow[];
  invoiceLines: InvoiceLineRow[];
  projectRefs: ProjectRef[];
  workspaces: VendorWorkspace[];
  /** `usd` is in `currency`: Meta's WhatsApp charges are ringgit. */
  usage: { month: string; vendor: string; workspaceId: string; usd: number; currency: string }[];
  moduleUsage: ModuleUsage[];
};
// A system's own AI cost estimate for one month, company (systemCode) and module; shares only.
export type ModuleUsage = { month: string; vendor: string; sourceSystem: string; systemCode: string; module: string; usd: number; calls: number; receivedAt: string };
export type VendorWorkspace = { vendor: string; workspaceId: string; name: string; systemCode: string; updatedAt: string; updatedBy: string | null };

export type AccountStatus = "yes" | "partly" | "not_yet" | "cant_move";
export type AccountRow = {
  id: number;
  name: string;
  companies: string;
  vendor: string;
  mainOwner: string;
  control: string;
  itAccess: string;
  status: AccountStatus;
  billsTo: string;
  registerIds: string;
  nextStep: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type HealthTarget = {
  id: number;
  name: string;
  systemCode: string | null;
  checkUrl: string;
  pageUrl: string;
  sort: number;
  active: number;
  updatedAt: string;
  updatedBy: string | null;
};
export type HealthStatus = "ok" | "warning" | "critical" | "off";
export type HealthReport = {
  ok: boolean;
  time: string | null;
  published_at?: string | null;
  db: { ok: boolean; latency_ms: number | null; error?: string } | null;
  storage: { bound: boolean; ok: boolean; latency_ms: number | null } | null;
  counts: Record<string, number | string | null>;
  checks: { key: string; label: string; value: string; status: HealthStatus; summary: string; detail?: string }[];
  problems: { at: string; what: string; where?: string | null; error?: string | null }[];
};
export type HealthReportRow = { systemCode: string; receivedAt: string; ok: number; report: HealthReport };
export type HealthCheck = {
  targetId: number;
  checkedAt: string;
  ok: number;
  status: number | null;
  ms: number | null;
  version: string | null;
  error: string | null;
};
export type User = {
  id: number;
  name: string;
  email: string | null;
  username?: string | null;
  roles?: string[];
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
  is_read: boolean;
};

export type NotificationsResponse = {
  notifications: Notification[];
  total: number;
  // The server stops counting at 1001; show "1000+".
  total_capped: boolean;
  page: number;
  page_size: number;
};

export type Attachment = { id: number; event_id: number; filename: string; mime: string; size: number };

export type TicketEvent = {
  id: number;
  kind: "created" | "comment" | "status" | "assign" | "priority" | "type" | "module";
  visibility: "public" | "internal";
  authorKind: "reporter" | "developer" | "system";
  authorName: string;
  userId: number | null;
  body: string | null;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
  editedAt: string | null;
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
  module: string | null;
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

// Reports dashboard (GET /tickets/report). Every list covers all systems; the page filters.
// Keys are days (this / last month) or months. hours is null for tickets imported from
// the old Sheet (done rows) or not picked up yet (response rows). it_hours / waiting_hours leave
// out / count the time in Waiting Reporter, which the SLA does not count.
export type ReportRange = "this" | "last" | 6 | 12;
export type ReportAge = "d0" | "d7" | "d14" | "d30";
type Period = "now" | "prev";
type KeyCount = { k: string; sys: string; type: TicketType; n: number };
export type Report = {
  range: ReportRange;
  daily: boolean;
  keys: string[];
  today: string;
  start: string;
  end: string;
  prev_start: string;
  active: { sys: string; type: TicketType; status: Status; priority: Priority; unassigned: boolean; age: ReportAge; n: number; oldest: string }[];
  // Every open ticket; stage_since = last status change, or submission if it never moved.
  open_tickets: {
    code: string;
    title: string;
    sys: string;
    type: TicketType;
    status: Status;
    priority: Priority;
    created_at: string;
    module: string | null;
    legacy: boolean;
    assignee_id: number | null;
    assignee: string | null;
    waiting_hours: number;
    stage_since: string;
  }[];
  // assignee = who held the ticket when it was done (response: who picked it up).
  // k = the day (this / last month) or month it was done, Malaysia time.
  done: {
    code: string;
    title: string;
    k: string;
    sys: string;
    type: TicketType;
    priority: Priority;
    module: string | null;
    period: Period;
    assignee: string | null;
    hours: number | null;
    it_hours: number | null;
  }[];
  response: { sys: string; type: TicketType; priority: Priority; period: Period; assignee: string | null; hours: number | null }[];
  opened: { sys: string; type: TicketType; period: Period; n: number }[];
  flow_opened: KeyCount[];
  flow_done: KeyCount[];
  backlog: KeyCount[];
  reopened: { sys: string; type: TicketType; period: Period; assignee: string | null; n: number }[];
  reporters: { name: string; sys: string; department: string | null; opened: number; bugs: number; open_now: number }[];
  follow_ups: { name: string; sys: string; n: number }[];
  modules: { sys: string; module: string | null; opened: number; bugs: number; open_now: number }[];
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
export const invoiceFileUrl = (id: number) => `${BASE}/billing/invoices/${id}/file`;
