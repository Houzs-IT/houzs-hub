// ---------------------------------------------------------------------------
// The screen map for explain_screen and where_is: every page of the portal,
// what its parts are for, and the buttons / tabs on it. Paths must exist in
// frontend/src/main.tsx; every action / tab label in frontend/src
// (backend/test/mcp-howto.test.mjs). `need` = the extra permission a button
// needs beyond opening the page, mirroring the code that shows it.
// ---------------------------------------------------------------------------
import type { HowtoGate } from "./mcp-howto-types.ts";

export type ScreenAction = { label: string; what: string; need?: HowtoGate; guide?: string };
export type Screen = {
  path: string;
  title: string;
  sidebar: string;
  keywords: string[];
  purpose: string;
  parts: { name: string; what: string }[];
  actions: ScreenAction[];
  tabs: string[];
};

const perm = (...any: string[]): HowtoGate => ({ kind: "perm", any });

export const SCREENS: Screen[] = [
  {
    path: "/tickets",
    title: "List",
    sidebar: "IT → Workspace → List",
    keywords: ["ticket list", "all tickets", "list"],
    purpose: "Every ticket in a table. By default only active tickets (Open, On Going, On Hold, Testing, Waiting Reporter). Clicking a row opens the ticket in a panel beside the list.",
    parts: [
      { name: "Toolbar", what: "Search tickets plus filter buttons for System, Type, Status, Priority, Assignee, Reporter; Clear filters when any is on." },
      { name: "Table", what: "Summary, Status, Priority, Assignee, Reporter, Created, Updated; click a heading to sort. A \"Reporter replied\" mark means the reporter wrote last." },
      { name: "Ticket panel", what: "Opens on the right: status button, Pick up, Reply, Overview (Assignee, Reporter, Priority, Type), Properties (System, Module), Timeline, Description and Activity." },
    ],
    actions: [
      { label: "New ticket", what: "Log a ticket (walk-in request).", guide: "report-it-problem" },
      { label: "Search tickets", what: "Search by code, title or reporter.", guide: "find-tickets" },
      { label: "Clear filters", what: "Back to all active tickets." },
      { label: "Pick up", what: "Assign an unassigned active ticket to yourself; Open moves to On Going.", guide: "triage-ticket" },
      { label: "Reply", what: "Jump to the reply box of the open ticket.", guide: "follow-up-ticket" },
      { label: "Reply to reporter", what: "Public comment the reporter sees in their system.", guide: "follow-up-ticket" },
      { label: "Add internal note", what: "Comment only hub users see.", guide: "follow-up-ticket" },
      { label: "Open full page", what: "Open the ticket on its own page (/tickets/CODE)." },
      { label: "Delete", what: "Delete the ticket with its comments and files (cannot be undone).", need: perm("delete_tickets"), guide: "close-ticket" },
    ],
    tabs: ["All", "Comments", "History"],
  },
  {
    path: "/tickets/:code",
    title: "Ticket page",
    sidebar: "Open full page from a ticket",
    keywords: ["ticket page", "ticket detail", "one ticket"],
    purpose: "One ticket on its own page: title, description and activity on the left; status, Overview, Properties and Timeline on the right.",
    parts: [
      { name: "Header", what: "All tickets link back to the List, the system name, Reply and (with Delete tickets) Delete." },
      { name: "Activity", what: "Reply box (Reply to reporter / Add internal note, Then move to a status) and the history; switch All / Comments / History." },
      { name: "Side", what: "Status button and Pick up, Overview, Properties (System, Module, Page, Sheet ID), Timeline (Picked up, Last updated)." },
    ],
    actions: [
      { label: "All tickets", what: "Back to the List." },
      { label: "Reply", what: "Jump to the reply box.", guide: "follow-up-ticket" },
      { label: "Pick up", what: "Take the ticket.", guide: "triage-ticket" },
      { label: "Then move to", what: "Change status together with the comment.", guide: "follow-up-ticket" },
      { label: "Delete", what: "Delete the ticket for good.", need: perm("delete_tickets"), guide: "close-ticket" },
    ],
    tabs: ["All", "Comments", "History"],
  },
  {
    path: "/board",
    title: "Board",
    sidebar: "IT → Workspace → Board",
    keywords: ["board", "kanban", "columns"],
    purpose: "Active and Done tickets as cards in status columns (Open, On Going, On Hold, Testing, Waiting Reporter, Done). Drag a card to another column to change its status; drag within a column to re-order.",
    parts: [
      { name: "Columns", what: "One per status; each card shows code, title, priority, assignee and time since submitted." },
      { name: "Toolbar", what: "Same filters as the List, without Status." },
    ],
    actions: [
      { label: "New ticket", what: "Log a ticket.", guide: "report-it-problem" },
      { label: "Drop here", what: "Drop target while dragging a card: changes its status.", guide: "change-ticket-status" },
    ],
    tabs: [],
  },
  {
    path: "/queue",
    title: "My queue",
    sidebar: "IT → Workspace → My queue",
    keywords: ["my queue", "my tickets", "assigned to me"],
    purpose: "The List limited to active tickets assigned to you. The sidebar count is how many you have.",
    parts: [{ name: "Table", what: "Same as the List, without the Assignee filter." }],
    actions: [{ label: "Search tickets", what: "Search your tickets." }],
    tabs: [],
  },
  {
    path: "/notifications",
    title: "Notifications",
    sidebar: "IT → Workspace → Notifications",
    keywords: ["notifications", "bell", "alerts"],
    purpose: "New tickets and replies that concern you, newest first; click one to open its ticket.",
    parts: [{ name: "List", what: "Unread ones have a coloured edge; filters by kind and unread only." }],
    actions: [{ label: "Mark all as read", what: "Clear the unread count.", guide: "ticket-notifications" }],
    tabs: [],
  },
  {
    path: "/reports",
    title: "Reports",
    sidebar: "IT → Workspace → Reports",
    keywords: ["reports", "sla", "dashboard", "statistics", "workload"],
    purpose: "The IT tickets report: open tickets right now, and for the chosen period submitted vs done, speed against the SLA, the IT team, systems, reporters and modules (Malaysia time).",
    parts: [
      { name: "Right now", what: "Open tickets, Not picked up, Waiting on reporter / on hold, Past SLA, open over 7 / 14 / 30 days; tiles open the List." },
      { name: "This period", what: "Submitted, done, typical time to done and first response vs the period before." },
      { name: "IT team", what: "Per person: open now, by stage, Past SLA, Done, Before, Met SLA." },
      { name: "Systems", what: "Open tickets per system and the Oldest open tickets with SLA time left." },
      { name: "Speed", what: "Bug vs development time to done and Met SLA per priority; Systems compared." },
      { name: "Reporters", what: "Who raises the most, Departments, By module, tickets submitted per system." },
    ],
    actions: [
      { label: "This month", what: "Period: this month so far (also Last month, 6 months, 12 months).", guide: "use-sla-view" },
      { label: "Past SLA", what: "Open tickets over their SLA target.", guide: "use-sla-view" },
    ],
    tabs: ["Now", "Trend", "IT team", "Systems", "Speed", "Reporters"],
  },
  {
    path: "/meetings",
    title: "Meetings",
    sidebar: "Meetings",
    keywords: ["meetings", "calendar", "rooms", "booking"],
    purpose: "The shared meeting rooms and your meetings: a calendar (day, week, month, list), your meetings, rooms, guest booking links; room managers also see Email and WhatsApp and Change log.",
    parts: [
      { name: "Left column (wide screens)", what: "Book a room, a mini month, Rooms, colour by room / company / me, Only my meetings, add a colleague's calendar, Make a guest booking link." },
      { name: "Calendar", what: "Click an empty time for a quick booking; click a meeting for its details." },
    ],
    actions: [
      { label: "Book a room", what: "Open the full meeting editor.", guide: "book-meeting-room" },
      { label: "Today", what: "Jump to today." },
      { label: "Make a guest booking link", what: "Go to Guest links.", guide: "guest-booking-link" },
      { label: "Add room", what: "Add a meeting room.", need: perm("meeting_rooms"), guide: "manage-meeting-rooms" },
      { label: "Create link", what: "Create a guest booking link.", guide: "guest-booking-link" },
    ],
    tabs: ["Calendar", "My meetings", "Rooms", "Guest links", "Email and WhatsApp", "Change log"],
  },
  {
    path: "/health",
    title: "System health",
    sidebar: "Admin → System health",
    keywords: ["health", "uptime", "down", "status"],
    purpose: "Each system's latest check (up / slow / down), speed, version and a 24-hour bar, checked every 5 minutes; each system's own health report in its tab.",
    parts: [
      { name: "All systems", what: "One card per checked system." },
      { name: "System tabs", what: "The health report the system sends: problems in the last 7 days, reports in the last 24 hours, other figures." },
    ],
    actions: [
      { label: "Check now", what: "Run every check now.", need: perm("health_edit"), guide: "check-system-health" },
      { label: "Add system", what: "Add a system to check.", need: perm("health_edit"), guide: "add-health-check" },
    ],
    tabs: ["All systems"],
  },
  {
    path: "/billing",
    title: "System billing",
    sidebar: "Finance → System billing",
    keywords: ["billing", "costs", "finance"],
    purpose: "What every system costs and which card pays, plus Account ownership. Tabs depend on your permissions: billing tabs need See / Edit system billing; Account ownership needs See / Edit account ownership.",
    parts: [
      { name: "Overview", what: "Every system side by side for a month; Export to Excel." },
      { name: "Register", what: "Every charge with filters." },
      { name: "Cards / Statements / Invoices", what: "The cards, what each was charged, and vendor invoices." },
      { name: "Monthly / Trend", what: "Charges by month in ringgit." },
    ],
    actions: [
      { label: "Add charge", what: "Add a service a system pays for.", need: perm("billing_edit"), guide: "add-billing-charge" },
      { label: "Add card", what: "Add a payment card.", need: perm("billing_edit"), guide: "add-billing-charge" },
      { label: "Add statement", what: "Add card statement lines.", need: perm("billing_edit"), guide: "add-card-statement" },
      { label: "Add invoices", what: "Read vendor invoice PDFs.", need: perm("billing_edit"), guide: "add-card-statement" },
      { label: "Add account", what: "Add an outside account.", need: perm("accounts_edit"), guide: "account-ownership" },
      { label: "Export to Excel", what: "Download the month as Excel.", guide: "view-system-billing" },
    ],
    tabs: ["Overview", "Register", "Cards", "Statements", "Invoices", "Monthly", "Trend", "Account ownership"],
  },
  {
    path: "/users",
    title: "Users",
    sidebar: "Admin → Users",
    keywords: ["users", "accounts", "staff"],
    purpose: "Every hub user: email, roles, status (Active / Inactive / Locked) and last seen. Manage users adds users, resets passwords and switches accounts off; Manage roles changes roles and per-user permissions.",
    parts: [
      { name: "Table", what: "User, Email, Roles, Status, Last seen, and the row menu." },
      { name: "Permissions", what: "Per-user overrides (inherit / allow / deny) for each permission." },
    ],
    actions: [
      { label: "Add user", what: "Create a user and show their first password once.", need: perm("users"), guide: "add-user" },
      { label: "Permissions", what: "Open the person's overrides.", need: perm("roles"), guide: "manage-user-access" },
      { label: "More actions", what: "Reset password, Deactivate / Reactivate, Delete user.", need: perm("users"), guide: "manage-user-access" },
    ],
    tabs: [],
  },
  {
    path: "/roles",
    title: "Roles",
    sidebar: "Admin → Roles",
    keywords: ["roles", "permissions"],
    purpose: "One card per role with its permissions as tick boxes; changes save as you go. Admin and Developer are built in.",
    parts: [{ name: "Role cards", what: "Name (editable), Built in tag, user count, permission tick boxes, delete bin for unused custom roles." }],
    actions: [
      { label: "Add role", what: "Create a role.", guide: "manage-roles" },
      { label: "Delete role", what: "Delete a custom role nobody has.", guide: "manage-roles" },
    ],
    tabs: [],
  },
  {
    path: "/integrations",
    title: "Integrations",
    sidebar: "Admin → Integrations",
    keywords: ["integrations", "connected systems", "keys"],
    purpose: "Each system and whether it is connected to the hub: Connected, key issued but never used, no key, or off; and when it last called.",
    parts: [{ name: "Systems", what: "One row per system with its connection state." }],
    actions: [],
    tabs: [],
  },
  {
    path: "/group-report",
    title: "Group report",
    sidebar: "Admin → Group report",
    keywords: ["group report", "monthly report"],
    purpose: "Connect each group system through its own AI Connector and build the monthly group report.",
    parts: [
      { name: "Systems", what: "Each system with Connect / Reconnect / Disconnect and who connected it." },
      { name: "Build a report", what: "Pick a month and build now (kept, not emailed)." },
      { name: "Past reports", what: "View or open each report." },
    ],
    actions: [
      { label: "Build report now", what: "Build the chosen month.", guide: "group-report" },
      { label: "Reconnect", what: "Sign in to that system again.", guide: "group-report" },
    ],
    tabs: [],
  },
  {
    path: "/ai-connector",
    title: "AI Connector",
    sidebar: "AI Connector",
    keywords: ["ai connector", "claude", "chatgpt", "brief"],
    purpose: "Connect Claude / ChatGPT with your own permissions, morning brief and alert emails, your connected apps; admins (Manage users) also approve access, switch AI actions, run a leak check, see recent lookups and questions with no guide yet.",
    parts: [
      { name: "Your connector address", what: "The address to paste into your AI app, or Request access." },
      { name: "Emails from the AI Connector", what: "Morning brief and Urgent alerts switches, Save, Preview my brief, Send me a test brief." },
      { name: "Admin sections", what: "Waiting for your approval, Connected people, Allowed to connect, AI actions, Leak check, Questions with no guide yet, Recent lookups." },
    ],
    actions: [
      { label: "Request access", what: "Ask the admin to turn the connector on for you.", guide: "connect-ai-connector" },
      { label: "Copy", what: "Copy your connector address.", guide: "connect-ai-connector" },
      { label: "Preview my brief", what: "See your morning brief now.", guide: "morning-brief-settings" },
      { label: "Send me a test brief", what: "Email yourself the brief.", guide: "morning-brief-settings" },
      { label: "Approve", what: "Approve an access request.", need: perm("users"), guide: "approve-ai-access" },
      { label: "Allow AI actions", what: "Main switch for AI ticket changes.", need: perm("users"), guide: "approve-ai-access" },
    ],
    tabs: ["Claude", "ChatGPT"],
  },
  {
    path: "/account",
    title: "My account",
    sidebar: "Menu under your name → My account",
    keywords: ["my account", "profile", "password"],
    purpose: "Your display name, email, password and notification sound.",
    parts: [
      { name: "Profile", what: "Display name and email." },
      { name: "Change password", what: "Current, new and confirm new password." },
      { name: "Notification sound", what: "Sound and volume of new-ticket alerts." },
    ],
    actions: [{ label: "Change password", what: "Save a new password (at least 10 characters).", guide: "update-my-account" }],
    tabs: [],
  },
];
