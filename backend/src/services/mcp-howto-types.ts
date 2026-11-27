// ---------------------------------------------------------------------------
// The data model of the AI Connector's process help (round 5, owner 2026-11-27):
// how_to guides and flows, module_overview, glossary, explain_error, onboarding.
//
// Mirrors the Houzs / Hookka connectors. Every page path must exist in
// frontend/src/main.tsx and every quoted label in frontend/src (the honesty test
// backend/test/mcp-howto.test.mjs checks both).
//
// No value imports from other backend modules: node --test loads this file as is.
// ---------------------------------------------------------------------------

/**
 * Who may open a page or do a step, in the hub's own permission keys
 * (backend/src/services/perms.ts PERMISSIONS). "open" = every signed-in hub user.
 * `any`: one of them is enough (the server's need(...) is an any-of check,
 * middleware/devAuth.ts). `all`: every one of them is needed.
 */
export type HowtoGate = { kind: "open" } | { kind: "perm"; any?: string[]; all?: string[] };

/** One field on the form: `label` is the exact UI label (checked against frontend/src). */
export type HowtoField = { label: string; required: boolean; format: string; validation: string; example: string };

/**
 * One click. `do` quotes UI labels in double quotes ("New ticket"); every quoted string in
 * do / check / then must exist in frontend/src. `highlight` is the label of the element to press
 * on `page`; the step's link opens `page?highlight=<label>`.
 */
export type HowtoStep = { do: string; page?: string; highlight?: string; check?: string; then?: string; role?: string };

/** A full SOP: one staff task ("task") or a whole chain across people ("flow"). */
export type HowtoGuide = {
  id: string;
  kind: "task" | "flow";
  title: string;
  module: string;
  keywords: string[];
  purpose: string;
  prerequisites: string[];
  who: string;
  /** The permission(s) in words, as the Roles page names them. */
  permission: string;
  /** Extra permission the task needs beyond opening its page (e.g. delete_tickets). */
  need?: HowtoGate;
  page: string;
  sidebar: string;
  fields: HowtoField[];
  steps: HowtoStep[];
  checkBefore: string[];
  result: string[];
  warnings: string[];
  undo: string;
  approvals: string[];
  deadlines: string[];
  commonMistakes: { mistake: string; fix: string }[];
  workedExample: string;
  related: string[];
  nextStep: string | null;
  contact: string;
};

/** The person a help answer is for: only their effective permissions matter. */
export type HowtoUser = { perms: readonly string[] };

export const gatePasses = (gate: HowtoGate, u: HowtoUser): boolean => {
  if (gate.kind === "open") return true;
  const anyOk = !gate.any || gate.any.some((p) => u.perms.includes(p));
  const allOk = !gate.all || gate.all.every((p) => u.perms.includes(p));
  return anyOk && allOk;
};

const IT: HowtoGate = { kind: "perm", any: ["it"] };

/**
 * The hub's pages and who may open them, mirroring the portal exactly:
 * - /tickets, /board, /queue, /reports and /tickets/:code: components/Layout.tsx IT_PATH sends anyone
 *   without "it" away, and routes/dev.ts guards /tickets and /tickets/* with need("it").
 * - /notifications: Layout.tsx hasNotifications = "it" AND "notifications" (routes/notifications.ts
 *   need("it"), need("notifications")).
 * - Admin pages: the sidebar's can(...) in Layout.tsx, matching each API's need(...) in routes/admin.ts,
 *   routes/health.ts, routes/billing.ts, routes/accounts.ts; /group-report needs Manage roles
 *   (routes/groupReport.ts GROUP_REPORT_PERMISSION).
 * - /meetings, /ai-connector and /account: every signed-in user (no guard in main.tsx; the sidebar shows
 *   them to everyone).
 */
export const PAGE_GATES: Record<string, HowtoGate> = {
  "/tickets": IT,
  "/tickets/:code": IT,
  "/board": IT,
  "/queue": IT,
  "/reports": IT,
  "/notifications": { kind: "perm", all: ["it", "notifications"] },
  "/users": { kind: "perm", any: ["users", "roles"] },
  "/roles": { kind: "perm", any: ["roles"] },
  "/integrations": { kind: "perm", any: ["integrations"] },
  "/health": { kind: "perm", any: ["health_view", "health_edit"] },
  // BillingPage.tsx: the Account ownership tab needs accounts_*, every other tab billing_*.
  "/billing": { kind: "perm", any: ["billing_view", "billing_edit", "accounts_view", "accounts_edit"] },
  "/group-report": { kind: "perm", any: ["roles"] },
  "/meetings": { kind: "open" },
  "/ai-connector": { kind: "open" },
  "/account": { kind: "open" },
  "/login": { kind: "open" },
};

const segMatch = (route: string, path: string): boolean => {
  const r = route.split("/");
  const p = path.split("/");
  return r.length === p.length && r.every((s, i) => s.startsWith(":") || s === p[i]);
};

/** The gate of a page (path with optional ?query). A billing tab gets that tab's own rule. Unknown page = closed. */
export function gateForPage(page: string): HowtoGate {
  const [path, query = ""] = page.split("?");
  if (path === "/billing") {
    const tab = new URLSearchParams(query).get("tab");
    if (tab === "accounts") return { kind: "perm", any: ["accounts_view", "accounts_edit"] };
    if (tab) return { kind: "perm", any: ["billing_view", "billing_edit"] };
  }
  if (Object.prototype.hasOwnProperty.call(PAGE_GATES, path)) return PAGE_GATES[path];
  const hit = Object.keys(PAGE_GATES).find((r) => segMatch(r, path));
  return hit ? PAGE_GATES[hit] : { kind: "perm", all: ["__none__"] };
}

/** May this person open the page? */
export const canOpenPage = (page: string, u: HowtoUser): boolean => gatePasses(gateForPage(page), u);

export const NO_PERMISSION_NOTE = "You don't have permission for this in the hub — ask your IT admin (someone with Manage roles).";

/** A hub link with ?highlight=<label> merged into the page's own query; null for a page that needs an id. */
export function hubLink(origin: string, page: string, highlight: string | null | undefined): string | null {
  if (page.includes(":")) return null;
  if (!highlight) return `${origin}${page}`;
  const sep = page.includes("?") ? "&" : "?";
  return `${origin}${page}${sep}highlight=${encodeURIComponent(highlight)}`;
}

/** One hub area, for module_overview. `sidebar` is the exact sidebar label. */
export type ModuleOverview = {
  id: string;
  name: string;
  sidebar: string;
  keywords: string[];
  purpose: string;
  keyPages: { path: string; label: string; what: string }[];
  users: string;
  connects: string[];
};

/** A term staff meet in the hub, for glossary. */
export type GlossaryTerm = { term: string; aliases: string[]; keywords: string[]; definition: string; seeAlso: string[]; page: string | null };

/** A first-week path for one role, for onboarding. `guides` are guide ids. */
export type OnboardingPath = {
  role: string;
  title: string;
  keywords: string[];
  days: { day: string; goals: string[]; guides: string[]; pages: string[] }[];
  contact: string;
};

/** A real hub error / validation message. Each `match` is a substring of the backend's own text. */
export type ErrorEntry = { id: string; match: string[]; module: string; meaning: string; cause: string; fix: string; source: string };
