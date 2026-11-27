// ---------------------------------------------------------------------------
// Made-up demo data for scripts/capture-help-shots.mjs. Every /api/* request of
// the portal is answered from here, so the screenshots never touch the live
// database. Nothing here is real: names are "Demo ...", emails end in
// example.invalid, ticket titles and money figures are invented.
// mockApi returns undefined for a call it does not know (the script logs it and
// answers {}).
// ---------------------------------------------------------------------------
const NOW = Date.parse("2026-11-26T03:00:00Z"); // a Thursday, 11:00 Malaysia time
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3_600_000).toISOString();
const DAY = (d) => new Date(NOW + d * 86_400_000).toISOString().slice(0, 10);

const PERMS = ["it", "notifications", "delete_tickets", "users", "roles", "integrations", "accounts_view", "accounts_edit", "billing_view", "billing_edit", "health_view", "health_edit", "meeting_rooms"];
const ME = { id: 1, name: "Demo Admin", email: "demo@example.invalid", username: "demo", roles: ["admin"], roleName: "Admin", perms: PERMS, mustChangePassword: 0 };
const USERS = [ME, { id: 2, name: "Demo Developer", email: "dev@example.invalid", username: "dev" }, { id: 3, name: "Demo Support", email: "support@example.invalid", username: "support" }];
const SYSTEMS = [
  { code: "DA", name: "Demo ERP A", active: 1 },
  { code: "DB", name: "Demo ERP B", active: 1 },
  { code: "DC", name: "Demo POS", active: 1 },
];
export const DEMO_TICKET = "DA-0042";

const T = (code, sys, title, status, priority, type, assignee, hours, reporter) => ({
  code,
  legacy_code: null,
  system_code: sys,
  type,
  priority,
  status,
  title,
  reporter_name: reporter,
  reporter_department: "Demo department",
  assignee_id: assignee,
  assignee_name: assignee ? USERS.find((u) => u.id === assignee).name : null,
  last_public_actor: status === "in_progress" ? "reporter" : "developer",
  created_at: iso(hours),
  updated_at: iso(hours / 2),
});
const TICKETS = [
  T("DA-0042", "DA", "Demo: delivery order prints a blank page", "open", "high", "bug", null, 3, "Demo Reporter 1"),
  T("DB-0107", "DB", "Demo: add a column to the stock report", "in_progress", "low", "development", 2, 30, "Demo Reporter 2"),
  T("DC-0019", "DC", "Demo: receipt printer offline at outlet", "waiting_reporter", "medium", "bug", 3, 20, "Demo Reporter 3"),
  T("DA-0039", "DA", "Demo: export to Excel times out", "testing", "medium", "bug", 2, 50, "Demo Reporter 4"),
  T("DB-0101", "DB", "Demo: new user cannot sign in", "on_hold", "medium", "bug", 1, 80, "Demo Reporter 5"),
  T("DA-0031", "DA", "Demo: change invoice footer text", "resolved", "low", "development", 2, 120, "Demo Reporter 6"),
];

function ticketDetail(code) {
  const r = TICKETS.find((t) => t.code === code) ?? TICKETS[0];
  return {
    ticket: {
      id: 1,
      code: r.code,
      legacyCode: null,
      systemCode: r.system_code,
      system_name: SYSTEMS.find((s) => s.code === r.system_code).name,
      type: r.type,
      priority: r.priority,
      status: r.status,
      title: r.title,
      description: "Demo description: what happened, where and since when. This is made-up demo text.",
      occurredAt: null,
      reporterExternalId: "demo",
      reporterName: r.reporter_name,
      reporterEmail: null,
      reporterPhone: null,
      reporterDepartment: "Demo department",
      pageUrl: null,
      module: null,
      userAgent: null,
      appVersion: null,
      assigneeId: r.assignee_id,
      pickedUpAt: null,
      resolvedAt: null,
      closedAt: null,
      lastPublicActor: r.last_public_actor,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    },
    events: [
      { id: 1, kind: "created", visibility: "public", authorKind: "reporter", authorName: r.reporter_name, userId: null, body: null, fromValue: null, toValue: null, createdAt: r.created_at, editedAt: null, attachments: [] },
      { id: 2, kind: "comment", visibility: "public", authorKind: "reporter", authorName: r.reporter_name, userId: null, body: "Demo comment from the reporter.", fromValue: null, toValue: null, createdAt: r.updated_at, editedAt: null, attachments: [] },
    ],
    modules: ["Demo module"],
  };
}

function report() {
  const keys = Array.from({ length: 26 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
  const open = TICKETS.filter((t) => t.status !== "resolved");
  return {
    range: "this",
    daily: true,
    keys,
    today: "2026-11-26",
    start: "2026-10-31T16:00:00.000Z",
    end: iso(0),
    prev_start: "2026-10-05T16:00:00.000Z",
    active: open.map((t) => ({ sys: t.system_code, type: t.type, status: t.status, priority: t.priority, unassigned: !t.assignee_id, age: "d0", n: 1, oldest: t.created_at })),
    open_tickets: open.map((t) => ({ code: t.code, title: t.title, sys: t.system_code, type: t.type, status: t.status, priority: t.priority, created_at: t.created_at, module: "Demo module", legacy: false, assignee_id: t.assignee_id, assignee: t.assignee_name, waiting_hours: 0, stage_since: t.updated_at })),
    done: [{ code: "DA-0031", title: "Demo done", k: "2026-11-20", sys: "DA", type: "development", priority: "low", module: "Demo module", period: "now", assignee: "Demo Developer", hours: 30, it_hours: 28 }],
    response: [{ sys: "DA", type: "bug", priority: "high", period: "now", assignee: "Demo Developer", hours: 1 }],
    opened: SYSTEMS.map((s) => ({ sys: s.code, type: "bug", period: "now", n: 3 })),
    flow_opened: keys.slice(-5).map((k) => ({ k, sys: "DA", type: "bug", n: 1 })),
    flow_done: keys.slice(-5).map((k) => ({ k, sys: "DA", type: "bug", n: 1 })),
    backlog: keys.slice(-5).map((k) => ({ k, sys: "DA", type: "bug", n: 4 })),
    reopened: [],
    reporters: [{ name: "Demo Reporter 1", sys: "DA", department: "Demo department", opened: 3, bugs: 2, open_now: 1 }],
    follow_ups: [],
    modules: [{ sys: "DA", module: "Demo module", opened: 3, bugs: 2, open_now: 1 }],
  };
}

const ROOMS = [
  { id: 1, name: "Demo Boardroom", location: "Demo HQ", address: "", floor: "Level 2", seats: 12, equipment: ["TV"], open_days: [1, 2, 3, 4, 5, 6], open_from: 8, open_to: 19, color: "#3b82f6", buffer_min: 10, max_hours: 4, advance_days: 60, active: true, closures: [] },
  { id: 2, name: "Demo Small Room", location: "Demo HQ", address: "", floor: "Level 1", seats: 4, equipment: [], open_days: [1, 2, 3, 4, 5], open_from: 9, open_to: 18, color: "#10b981", buffer_min: 0, max_hours: 2, advance_days: 30, active: true, closures: [] },
];
const PEOPLE = USERS.map((u) => ({ key: `IT:${u.id}`, name: u.name, email: u.email, company: "Demo Company", department: "IT" }));
const at = (d, h) => new Date(Date.parse(`${DAY(d)}T00:00:00+08:00`) + h * 3_600_000).toISOString();
const MEETINGS = [
  { id: 1, title: "Demo stand-up", start: at(0, 10), end: at(0, 10.5), roomId: 1, organizer: "IT:1", bookedBy: "IT:1", attendees: ["IT:2"], notes: "", video: { type: "none", url: "" }, reminders: [], status: "scheduled", startedAt: null, endedAt: null, seriesId: null, createdIn: "IT", linkId: null, guest: null },
  { id: 2, title: "Demo supplier call", start: at(1, 14), end: at(1, 15), roomId: null, organizer: "IT:2", bookedBy: "IT:2", attendees: ["IT:1"], notes: "", video: { type: "link", url: "https://example.invalid/meet" }, reminders: [], status: "scheduled", startedAt: null, endedAt: null, seriesId: null, createdIn: "IT", linkId: null, guest: null },
];

const HEALTH = {
  targets: [
    { id: 1, name: "Demo ERP A", systemCode: "DA", checkUrl: "https://demo-a.example.invalid/health", pageUrl: "", sort: 1, active: 1, updatedAt: iso(100), updatedBy: "Demo Admin" },
    { id: 2, name: "Demo ERP B", systemCode: "DB", checkUrl: "https://demo-b.example.invalid/health", pageUrl: "", sort: 2, active: 1, updatedAt: iso(100), updatedBy: "Demo Admin" },
  ],
  checks: [1, 2].flatMap((targetId) => Array.from({ length: 12 }, (_, i) => ({ targetId, checkedAt: iso(i / 12), ok: 1, status: 200, ms: 180 + targetId * 40, version: "demo-1.0", error: null }))),
  systems: SYSTEMS.map(({ code, name }) => ({ code, name })),
  reports: { latest: [], history: [] },
};

const CARD = { id: 1, nickname: "Demo Visa", last4: "0000", bank: "Demo Bank", holder: "Demo Admin", company: "Demo Company", statementDay: 25, notes: "", updatedAt: iso(200), updatedBy: "Demo Admin" };
const charge = (id, vendor, sys, amount) => ({ id, registerId: `D0${id}`, accountId: null, company: "Demo Company", system: SYSTEMS.find((s) => s.code === sys).name, systemCode: sys, projectRef: "", module: "", splitByUsage: 0, splits: [], vendor, serviceType: "Hosting", usedFor: "Demo", plan: "Pro", amount, currency: "USD", billed: "monthly", card: "Demo Visa", status: "confirmed", checkedOn: DAY(-10), keyName: "", notes: "", updatedAt: iso(200), updatedBy: "Demo Admin" });
const BILLING = {
  charges: [charge(1, "Demo Cloud", "DA", 25), charge(2, "Demo Database", "DB", 25), charge(3, "Demo Email", "DC", 20)],
  systems: SYSTEMS.map(({ code, name }) => ({ code, name })),
  cards: [CARD],
  accounts: [],
  lines: [{ id: 1, txnDate: DAY(-20), card: "Demo Visa", description: "DEMO CLOUD", registerId: "D01", amountMyr: 112.5, notes: "", checkedByHand: 0, updatedAt: iso(200), updatedBy: "Demo Admin" }],
  invoices: [],
  invoiceLines: [],
  projectRefs: [],
  workspaces: [],
  usage: [],
  moduleUsage: [],
};
const ACCOUNTS = [{ id: 1, name: "Demo cloud account", companies: "Demo Company", vendor: "Demo Cloud", mainOwner: "Demo Admin", control: "Demo Admin", itAccess: "", status: "not_yet", billsTo: "Demo Visa", registerIds: "D01", nextStep: "Demo next step", createdAt: iso(300), updatedAt: iso(300), updatedBy: "Demo Admin" }];

const PERM_DEFS = [
  ["it", "IT tickets"], ["notifications", "Get notifications"], ["delete_tickets", "Delete tickets"], ["users", "Manage users"], ["roles", "Manage roles"], ["integrations", "See Integrations"],
  ["accounts_view", "See account ownership"], ["accounts_edit", "Edit account ownership"], ["billing_view", "See system billing"], ["billing_edit", "Edit system billing"],
  ["health_view", "See system health"], ["meeting_rooms", "Manage meeting rooms"], ["health_edit", "Edit system health"],
].map(([key, label]) => ({ key, label, hint: "" }));
const ROLES = [
  { key: "admin", name: "Admin", permissions: PERMS, users: 1, builtIn: true },
  { key: "developer", name: "Developer", permissions: ["it", "notifications"], users: 2, builtIn: true },
];
const ADMIN_USERS = USERS.map((u) => ({ id: u.id, email: u.email, username: u.username, name: u.name, roles: u.id === 1 ? ["admin"] : ["developer"], permAllow: [], permDeny: [], active: 1, lockedUntil: null, lastSeenAt: iso(1) }));

const NOTIFICATIONS = {
  notifications: [{ id: 1, kind: "created", visibility: "public", author_name: "Demo Reporter 1", body: null, to_value: null, created_at: iso(3), ticket_code: "DA-0042", ticket_title: TICKETS[0].title, is_read: false }],
  total: 1,
  total_capped: false,
  page: 1,
  page_size: 25,
};

const CONNECTOR_URL = "https://hub.example.invalid/api/mcp";
const OVERVIEW = {
  connectorUrl: CONNECTOR_URL,
  stats: { connectedPeople: 1, callsToday: 4, refusedToday: 0, waiting: 1 },
  limits: { perMinute: 30, perDay: 1000, exportRows: 5000, exportLinkMinutes: 15 },
  requests: [{ userId: 3, name: "Demo Support", position: "Developer", id: "req-demo", reason: "", createdAt: iso(2) }],
  connected: [{ userId: 2, name: "Demo Developer", position: "Developer", tokenId: "tok-demo", app: "Claude", connectedAt: iso(48), lastUsedAt: iso(1) }],
  allowed: [{ userId: 2, name: "Demo Developer", position: "Developer", approvedAt: iso(50) }],
  calls: [{ id: "c1", userId: 2, name: "Demo Developer", app: "Claude", tool: "how_to", target: "how_to report-it-problem", status: 200, ok: true, note: "", ms: 12, at: iso(1) }],
  noGuide: [{ tool: "how_to", question: "demo question nobody wrote a guide for", times: 2, lastAt: iso(5) }],
  staff: [{ userId: 3, name: "Demo Support", position: "Developer" }],
  actions: { enabled: false, perDay: 20, confirmMinutes: 10, list: [{ key: "ticket", label: "Log a new ticket", enabled: false }, { key: "ticket_comment", label: "Comment on a ticket", enabled: false }, { key: "ticket_update", label: "Assign / change status", enabled: false }] },
};
const BRIEF = {
  allowed: true,
  email: "demo@example.invalid",
  mailReady: true,
  saved: true,
  subscription: { briefEnabled: true, briefTime: "08:00", briefDays: "weekdays", alertsEnabled: false },
  thresholds: ["Demo rule: a High ticket nobody has picked up for 2 hours."],
  schedule: "Demo schedule: briefs go out on the hour and half hour, Malaysia time.",
  recent: [],
};
const GROUP = {
  configured: true,
  mailReady: true,
  schedule: "Demo schedule: the 1st of each month from 09:00 Malaysia time.",
  systems: [
    { key: "a", name: "Demo ERP A", mcpUrl: "https://demo-a.example.invalid/api/mcp", companies: ["Demo Company"], connected: true, connectedBy: "Demo Admin", connectedAt: iso(100), lastUsedAt: iso(20) },
    { key: "b", name: "Demo ERP B", mcpUrl: "https://demo-b.example.invalid/api/mcp", companies: ["Demo Company B"], connected: false, connectedBy: null, connectedAt: null, lastUsedAt: null },
  ],
  reports: [{ id: 1, month: "2026-10", kind: "manual", builtAt: iso(200), builtBy: "Demo Admin", systems: [{ key: "a", name: "Demo ERP A", status: "ok" }], emailedTo: [] }],
};

/** The demo answer for one portal API call, or undefined when it is not mocked. */
export function mockApi(method, u) {
  const p = u.pathname.replace(/\/+$/, "");
  if (method !== "GET") return { ok: true, online: [] };
  const dev = p.startsWith("/api/v1/dev") ? p.slice("/api/v1/dev".length) : null;
  if (dev !== null) {
    if (dev === "/me") return { user: ME };
    if (dev === "/users") return { users: USERS };
    if (dev === "/systems") return { systems: SYSTEMS };
    if (dev === "/tickets/stats") return { active_by_system: { DA: 3, DB: 1, DC: 1 }, my_active: 1, unread_notifications: 1 };
    if (dev === "/tickets/reporters") return { reporters: TICKETS.map((t) => t.reporter_name) };
    if (dev === "/tickets/report") return report();
    if (dev === "/tickets") {
      const status = u.searchParams.get("status");
      const list = status && status !== "all" ? TICKETS.filter((t) => status.split(",").includes(t.status) || (status === "active" && t.status !== "resolved")) : TICKETS.filter((t) => t.status !== "resolved");
      return { tickets: list, total: list.length, page: 1, page_size: 50 };
    }
    if (dev.startsWith("/tickets/")) return ticketDetail(decodeURIComponent(dev.slice("/tickets/".length)));
    if (dev === "/notifications") return NOTIFICATIONS;
    if (dev === "/health") return HEALTH;
    if (dev === "/billing") return BILLING;
    if (dev === "/accounts") return { accounts: ACCOUNTS };
    if (dev === "/admin/users") return { users: ADMIN_USERS };
    if (dev === "/admin/roles") return { roles: ROLES, permissions: PERM_DEFS };
    if (dev === "/admin/systems") return { systems: SYSTEMS.map((s) => ({ ...s, hasKey: true, lastCallAt: iso(1), lastSendError: null, lastSendErrorAt: null })) };
    return undefined;
  }
  if (p === "/api/v1/meetings/bootstrap") return { me: "IT:1", canManage: true, rooms: ROOMS, people: PEOPLE, unread: 0, meetConnected: false };
  if (p === "/api/v1/meetings/calendar") return { meetings: MEETINGS };
  if (p === "/api/v1/meetings/mine") return { meetings: MEETINGS, notifications: [] };
  if (p === "/api/v1/meetings/links") return { links: [] };
  if (p === "/api/v1/meetings/log") return { log: [] };
  if (p === "/api/v1/meetings/unread") return { unread: 0 };
  if (p === "/api/v1/ai-connector/me") return { allowed: true, isAdmin: true, pendingRequest: null, connectorUrl: CONNECTOR_URL, apps: [{ tokenId: "tok-me", app: "Claude", connectedAt: iso(30), lastUsedAt: iso(1) }] };
  if (p === "/api/v1/ai-connector/admin/overview") return OVERVIEW;
  if (p === "/api/v1/ai-brief/me") return BRIEF;
  if (p === "/api/v1/group-report") return GROUP;
  return undefined;
}
