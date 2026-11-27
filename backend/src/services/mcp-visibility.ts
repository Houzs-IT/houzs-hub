// ---------------------------------------------------------------------------
// mcp-visibility.ts — AI Connector round 4c (platform quality), pure, no runtime
// imports (unit-tested under node in backend/test/mcp-4bc.test.mjs).
//
//   P1 role-aware tools/list: a tool is listed only when the person holds the
//      hub permission its endpoints check (TOOL_NEEDS mirrors the routes'
//      need(...) — dev.ts "it", health.ts "health_view"/"health_edit",
//      notifications.ts "it"+"notifications", billing / accounts views), and a
//      write tool only while its switches are on. A hidden tool called directly
//      answers "no access" (routes/mcp.ts callTool).
//   P2 prompts per role (IT morning triage, my tickets, IT manager weekly …),
//      listed when the tools they use are listed.
//   P3 structuredContent + an open outputSchema on the quick answers.
//   P4 a 60 s per-person cache for the heavy summaries.
//   P5 a hub link on every answer and on every ticket row.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

/**
 * Hub permissions a read tool needs: ANY ONE of the groups, a group = ALL of its
 * permissions. null = everyone (the tool's parts say "no access" on their own).
 */
export const TOOL_NEEDS: Record<string, string[][] | null> = {
  ticket_summary: [["it"]],
  tickets_today: [["it"]],
  open_tickets: [["it"]],
  my_tickets: [["it"]],
  export_excel: [["it"]],
  search: [["it"]],
  fetch: [["it"]],
  tickets_overdue: [["it"]],
  ticket_digest: [["it"]],
  health_summary: [["health_view"], ["health_edit"]],
  data_gaps: [["it"], ["billing_view"], ["billing_edit"], ["accounts_view"], ["accounts_edit"]],
  daily_brief: null,
  meetings_today: null,
  whoami: null,
  list_modules: null,
  list_endpoints: null,
  erp_get: null,
  // Round 5 process help (services/mcp-howto.ts): no hub data, so open to everyone;
  // each answer's canDo / canOpen follows the person's own permissions.
  how_to: null,
  module_overview: null,
  glossary: null,
  explain_error: null,
  onboarding: null,
  explain_screen: null,
  where_is: null,
};

const LABEL: Record<string, string> = {
  it: "IT tickets",
  health_view: "See system health",
  health_edit: "Edit system health",
  billing_view: "See system billing",
  billing_edit: "Edit system billing",
  accounts_view: "See account ownership",
  accounts_edit: "Edit account ownership",
};

export function holdsNeeds(perms: readonly string[], needs: string[][] | null | undefined): boolean {
  if (needs === null || needs === undefined) return true;
  return needs.some((group) => group.every((p) => perms.includes(p)));
}

/** "IT tickets" / "See system health or Edit system health" — for the no-access line. */
export function needLabel(name: string): string {
  const n = TOOL_NEEDS[name];
  if (!n) return "this";
  return n.map((g) => g.map((p) => LABEL[p] ?? p).join(" + ")).join(" or ");
}

export type Switches = { main: boolean } & Record<string, boolean>;

/**
 * May this person use (and see) this tool now? Read tools: TOOL_NEEDS.
 * propose_*: main switch + the action's switch + the route's permission.
 * confirm_action / cancel_action: main switch + any action switched on + the permission.
 */
export function toolAllowed(
  name: string,
  perms: readonly string[],
  sw: Switches,
  write: { toolAction: Record<string, string>; permission: Record<string, string>; actions: readonly string[] },
): boolean {
  const action = Object.hasOwn(write.toolAction, name) ? write.toolAction[name] : undefined;
  if (action) return sw.main && sw[action] === true && perms.includes(write.permission[action]);
  if (name === "confirm_action" || name === "cancel_action") return sw.main && write.actions.some((a) => sw[a] === true && perms.includes(write.permission[a]));
  return holdsNeeds(perms, TOOL_NEEDS[name]);
}

// ── P2 prompts per role ─────────────────────────────────────────────────────

export const ROLE_PROMPTS = [
  {
    name: "it_morning_triage",
    title: "IT morning triage",
    description: "Start the IT day: what came in and was resolved, what is overdue past SLA, urgent tickets nobody has, and what to pick up first.",
    arguments: [{ name: "system", description: "System code, e.g. HC (default: all systems)", required: false }],
  },
  {
    name: "my_tickets_review",
    title: "My tickets",
    description: "Your open tickets, most urgent first: what is waiting on you, what is waiting on the reporter, and what has sat too long.",
    arguments: [],
  },
  {
    name: "it_manager_weekly",
    title: "IT manager weekly",
    description: "The week at the IT desk: tickets in vs resolved against last week, by system and person, SLA breaches, what the tickets were about, and records missing data.",
    arguments: [],
  },
];

/** The tools each prompt uses; a prompt is listed when the FIRST is listed for the person. */
export const PROMPT_TOOLS: Record<string, string[]> = {
  it_morning_triage: ["tickets_today", "tickets_overdue", "daily_brief"],
  my_tickets_review: ["my_tickets", "daily_brief"],
  it_manager_weekly: ["ticket_summary", "tickets_overdue", "ticket_digest", "data_gaps"],
  "daily-brief": ["daily_brief"],
  ticket_desk_today: ["ticket_summary"],
  systems_health_now: ["health_summary"],
  find_ticket: ["search", "fetch"],
  how_do_i: ["how_to"],
  explain_this_error: ["explain_error"],
  my_first_week: ["onboarding"],
};

export function rolePromptText(name: string, args: Obj): string | null {
  const sys = String(args.system ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  switch (name) {
    case "it_morning_triage":
      return `Morning triage for the IT desk${sys ? ` (system ${sys})` : ""}. Use tickets_today${sys ? ` {system: "${sys}"}` : ""}, then tickets_overdue${sys ? ` {system: "${sys}"}` : ""}. Tell me in short: what came in and was resolved since yesterday by system; every ticket past its SLA (code, how late, who has it); every urgent ticket nobody is assigned to; then suggest who should pick up what first. Give ticket codes with their links. Do not change anything unless I ask; if I ask you to assign or close a ticket, use propose_ticket_update and show me the summary first.`;
    case "my_tickets_review":
      return "Review my tickets. Use my_tickets. Start with high priority and anything open more than 7 days, then what is waiting on the reporter. One line per ticket: code (with link), title, status, how long open. End with the one thing I should do first. If I ask you to comment, reassign or close one, use propose_ticket_comment / propose_ticket_update and show me the summary first.";
    case "it_manager_weekly":
      return 'IT manager weekly review. Use ticket_summary {period: "week"}, tickets_overdue, ticket_digest {period: "week"} and data_gaps. Report: tickets in vs resolved this week against last week, by system and by person; median time to resolve; every SLA breach still open; the main themes of what was reported (from the digest), by system; and records missing an assignee or module. Keep it to one screen, with ticket codes as links.';
    default:
      return null;
  }
}

// ── P3 structured output ────────────────────────────────────────────────────

/** Quick answers that return one JSON object: they carry an open outputSchema and structuredContent. */
export const STRUCTURED_TOOLS = new Set([
  "ticket_summary",
  "tickets_today",
  "daily_brief",
  "open_tickets",
  "my_tickets",
  "meetings_today",
  "health_summary",
  "tickets_overdue",
  "ticket_digest",
  "data_gaps",
]);
export const QUICK_OUTPUT_SCHEMA = { type: "object", additionalProperties: true } as const;

// ── P5 links ────────────────────────────────────────────────────────────────

/** The hub page each answer comes from. */
export const TOOL_PAGE: Record<string, string> = {
  ticket_summary: "/reports",
  tickets_today: "/tickets",
  daily_brief: "/queue",
  open_tickets: "/tickets",
  my_tickets: "/queue",
  meetings_today: "/meetings",
  health_summary: "/health",
  tickets_overdue: "/reports",
  ticket_digest: "/tickets",
  data_gaps: "/tickets",
};

const CODE_RE = /^[A-Za-z0-9]{1,12}-[A-Za-z0-9-]{1,20}$/;

/** Adds `hubLink` (the answer's page) and a `url` to every row that has a ticket `code` but no link. */
export function withHubLinks(name: string, value: unknown, origin: string): Obj {
  const walk = (x: unknown, depth: number): unknown => {
    if (depth > 12) return x;
    if (Array.isArray(x)) return x.map((y) => walk(y, depth + 1));
    if (x && typeof x === "object") {
      const o: Obj = {};
      for (const [k, v] of Object.entries(x as Obj)) o[k] = walk(v, depth + 1);
      if (typeof o.code === "string" && CODE_RE.test(o.code) && o.url === undefined && o.link === undefined) o.url = `${origin}/tickets/${encodeURIComponent(o.code)}`;
      return o;
    }
    return x;
  };
  const base = value && typeof value === "object" && !Array.isArray(value) ? (walk(value, 0) as Obj) : { value: walk(value, 0) };
  return TOOL_PAGE[name] ? { ...base, hubLink: `${origin}${TOOL_PAGE[name]}` } : base;
}

// ── P4 cache ────────────────────────────────────────────────────────────────

export const CACHE_TTL_MS = 60_000;
export const CACHEABLE_TOOLS = new Set(["ticket_summary", "tickets_today", "tickets_overdue", "ticket_digest", "data_gaps", "daily_brief"]);

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as Obj).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Obj)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
};

/** Per isolate, per person + their permissions + tool + arguments; successful answers only. */
export class AnswerCache<T> {
  private m = new Map<string, { v: T; exp: number }>();
  private ttl: number;
  private max: number;
  // No parameter properties: node's type stripping (the tests) does not support them.
  constructor(ttl = CACHE_TTL_MS, max = 300) {
    this.ttl = ttl;
    this.max = max;
  }
  static key(userId: number, perms: readonly string[], tool: string, args: unknown): string {
    return `${userId}|${[...perms].sort().join(",")}|${tool}|${stable(args)}`;
  }
  get(k: string, now = Date.now()): T | null {
    const e = this.m.get(k);
    if (!e) return null;
    if (e.exp <= now) {
      this.m.delete(k);
      return null;
    }
    return e.v;
  }
  set(k: string, v: T, now = Date.now()): void {
    if (this.m.size >= this.max) {
      for (const [key, e] of this.m) if (e.exp <= now) this.m.delete(key);
      if (this.m.size >= this.max) this.m.delete(this.m.keys().next().value as string);
    }
    this.m.set(k, { v, exp: now + this.ttl });
  }
  /** After a confirmed write: that person's answers may be stale. */
  dropUser(userId: number): void {
    for (const k of this.m.keys()) if (k.startsWith(`${userId}|`)) this.m.delete(k);
  }
}
