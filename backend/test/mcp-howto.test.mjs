// AI Connector round 5 (src/services/mcp-howto*.ts): process help. Honesty tests
// (every page exists in the router, every quoted label in frontend/src, every
// error text in the backend source) plus behaviour: RBAC canDo, the gap log note,
// redaction, the screen map. Run: npm --prefix backend test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOWTO_GUIDES, HOWTO_TOOLS, NO_GUIDE_NOTE, matchErrors, redactQuestion, runHowtoTool, screenForLabels, screenForPath, whereIs } from "../src/services/mcp-howto.ts";
import { GLOSSARY, MODULES, ONBOARDING } from "../src/services/mcp-howto-reference.ts";
import { ERRORS } from "../src/services/mcp-howto-errors.ts";
import { SCREENS } from "../src/services/mcp-howto-screens.ts";
import { PAGE_GATES, canOpenPage, gateForPage, hubLink } from "../src/services/mcp-howto-types.ts";
import { TOOL_NEEDS } from "../src/services/mcp-visibility.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const FRONT = join(here, "../../frontend/src");
const BACK = join(here, "../src");

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e) && !/\.test\./.test(e)) out.push(p);
  }
  return out;
}

const frontRaw = walk(FRONT).map((f) => readFileSync(f, "utf8")).join("\n");
const frontCollapsed = frontRaw.replace(/\s+/g, " ");
const frontJsx = frontCollapsed.replace(/>\s+/g, ">").replace(/\s+</g, "<");
/** Does a UI label appear in frontend/src (outside tests)? Labels split over JSX lines still match. */
const labelInFrontend = (label) => {
  const l = label.replace(/\s+/g, " ").trim();
  return !!l && (frontRaw.includes(l) || frontCollapsed.includes(l) || frontJsx.includes(l));
};
const backendCorpus = walk(BACK)
  .filter((f) => !/^mcp-howto/.test(basename(f)))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

const ROUTES = [...readFileSync(join(FRONT, "main.tsx"), "utf8").matchAll(/path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== "*");
const routeExists = (page) => {
  const segs = page.split("?")[0].split("/");
  return ROUTES.some((r) => {
    const rs = r.split("/");
    return rs.length === segs.length && rs.every((s, i) => s.startsWith(":") || segs[i].startsWith(":") || s === segs[i]);
  });
};
const quoted = (t) => [...(t ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const ids = new Set(HOWTO_GUIDES.map((g) => g.id));
const O = "https://support.example";

// ── honesty ─────────────────────────────────────────────────────────────────

test("guides: unique ids and every SOP field filled", () => {
  assert.equal(ids.size, HOWTO_GUIDES.length);
  assert.ok(HOWTO_GUIDES.length >= 25, String(HOWTO_GUIDES.length));
  for (const g of HOWTO_GUIDES) {
    for (const k of ["title", "purpose", "who", "permission", "page", "sidebar", "undo", "workedExample", "contact"]) assert.ok(String(g[k]).trim(), `${g.id}.${k}`);
    for (const k of ["keywords", "prerequisites", "steps", "checkBefore", "result", "warnings", "commonMistakes", "related"]) assert.ok(Array.isArray(g[k]), `${g.id}.${k}`);
    assert.ok(g.steps.length >= 2, `${g.id} steps`);
    assert.ok(g.keywords.length >= 3, `${g.id} keywords`);
    assert.ok(g.result.length && g.warnings.length && g.commonMistakes.length && g.prerequisites.length, `${g.id} lists`);
    assert.ok(Array.isArray(g.approvals) && Array.isArray(g.deadlines) && Array.isArray(g.fields), g.id);
    assert.ok(g.steps.some((s) => s.highlight && s.page), `${g.id}: at least one step links with ?highlight=`);
  }
});

test("guides: every page path exists in the frontend router", () => {
  const bad = [];
  for (const g of HOWTO_GUIDES) {
    if (!routeExists(g.page)) bad.push(`${g.id}: ${g.page}`);
    for (const s of g.steps) if (s.page && !routeExists(s.page)) bad.push(`${g.id} step: ${s.page}`);
  }
  assert.deepEqual(bad, []);
});

test("guides: every quoted label, highlight and field label exists in frontend/src", () => {
  const bad = [];
  for (const g of HOWTO_GUIDES) {
    const labels = [...g.fields.map((f) => f.label)];
    for (const s of g.steps) {
      labels.push(...quoted(s.do), ...quoted(s.check), ...quoted(s.then));
      if (s.highlight) labels.push(s.highlight);
    }
    for (const l of labels) if (!labelInFrontend(l)) bad.push(`${g.id}: "${l}"`);
  }
  assert.deepEqual(bad, []);
});

test("guides: related / nextStep point at real guides; flows are click by click with roles", () => {
  const bad = [];
  for (const g of HOWTO_GUIDES) {
    for (const r of g.related) if (!ids.has(r)) bad.push(`${g.id} related ${r}`);
    if (g.nextStep && !ids.has(g.nextStep)) bad.push(`${g.id} nextStep ${g.nextStep}`);
    if (g.kind === "flow") assert.ok(g.steps.length >= 6 && g.steps.every((s) => s.role), `${g.id}: a flow names who does each step`);
  }
  assert.deepEqual(bad, []);
  assert.ok(HOWTO_GUIDES.filter((g) => g.kind === "flow").length >= 2);
});

test("guides: English only outside keywords", () => {
  const bad = HOWTO_GUIDES.filter((g) => /[㐀-鿿]/.test(JSON.stringify({ ...g, keywords: [] }))).map((g) => g.id);
  assert.deepEqual(bad, []);
});

test("guides: the scope asked for is covered", () => {
  for (const id of ["report-it-problem", "follow-up-ticket", "triage-ticket", "assign-ticket", "change-ticket-status", "close-ticket", "use-sla-view", "book-meeting-room", "check-system-health", "view-system-billing", "connect-ai-connector", "morning-brief-settings", "group-report", "add-user", "manage-roles", "manage-user-access"])
    assert.ok(ids.has(id), id);
});

test("module overview: pages exist, sidebar and page labels exist in frontend/src", () => {
  const bad = [];
  for (const m of MODULES) {
    if (!labelInFrontend(m.sidebar)) bad.push(`${m.id}: sidebar "${m.sidebar}"`);
    for (const p of m.keyPages) {
      if (!routeExists(p.path)) bad.push(`${m.id}: ${p.path}`);
      if (!labelInFrontend(p.label)) bad.push(`${m.id}: "${p.label}"`);
    }
  }
  assert.deepEqual(bad, []);
  assert.equal(new Set(MODULES.map((m) => m.id)).size, MODULES.length);
});

test("glossary: unique terms, pages exist, English definitions, the asked terms are there", () => {
  assert.equal(new Set(GLOSSARY.map((t) => t.term.toLowerCase())).size, GLOSSARY.length);
  assert.deepEqual(GLOSSARY.filter((t) => (t.page && !routeExists(t.page)) || /[㐀-鿿]/.test(t.definition)).map((t) => t.term), []);
  for (const t of ["SLA", "Priority", "Module", "System"]) assert.ok(GLOSSARY.some((g) => g.term === t), t);
});

test("onboarding: every guide id and page exists", () => {
  const bad = [];
  for (const o of ONBOARDING)
    for (const d of o.days) {
      for (const g of d.guides) if (!ids.has(g)) bad.push(`${o.role}: ${g}`);
      for (const p of d.pages) if (!routeExists(p)) bad.push(`${o.role}: ${p}`);
    }
  assert.deepEqual(bad, []);
});

test("explain_error: every match string is the backend's own text", () => {
  const bad = [];
  for (const e of ERRORS) for (const m of e.match) if (!backendCorpus.includes(m)) bad.push(`${e.id}: "${m}"`);
  assert.deepEqual(bad, []);
  assert.equal(new Set(ERRORS.map((e) => e.id)).size, ERRORS.length);
});

test("screen map: every path is a route, every action / tab label exists, guides are real", () => {
  const bad = [];
  for (const s of SCREENS) {
    if (!routeExists(s.path)) bad.push(s.path);
    for (const a of s.actions) {
      if (!labelInFrontend(a.label)) bad.push(`${s.path}: "${a.label}"`);
      if (a.guide && !ids.has(a.guide)) bad.push(`${s.path}: guide ${a.guide}`);
    }
    for (const t of s.tabs) if (!labelInFrontend(t)) bad.push(`${s.path}: tab "${t}"`);
  }
  assert.deepEqual(bad, []);
  // Every routed portal page has a screen and a gate.
  for (const r of ROUTES.filter((x) => !["/", "/login", "/ai-connect", "/book/:code", "/accounts"].includes(x))) {
    assert.ok(SCREENS.some((s) => s.path === r), `screen for ${r}`);
    assert.ok(Object.hasOwn(PAGE_GATES, r), `gate for ${r}`);
  }
});

// ── RBAC: canDo follows the hub's own permissions ──────────────────────────

const as = (perms) => ({ user: { perms }, origin: O });
const call = (perms, name, args) => JSON.parse(runHowtoTool(as(perms), name, args).result.content[0].text);

test("RBAC: page gates mirror the portal (Layout.tsx / need(...))", () => {
  assert.equal(canOpenPage("/tickets", { perms: [] }), false);
  assert.equal(canOpenPage("/tickets/HC-1", { perms: ["it"] }), true);
  assert.equal(canOpenPage("/notifications", { perms: ["it"] }), false, "needs it AND notifications");
  assert.equal(canOpenPage("/notifications", { perms: ["it", "notifications"] }), true);
  assert.equal(canOpenPage("/users", { perms: ["roles"] }), true);
  assert.equal(canOpenPage("/roles", { perms: ["users"] }), false);
  assert.equal(canOpenPage("/billing?tab=accounts", { perms: ["billing_view"] }), false, "Account ownership has its own permission");
  assert.equal(canOpenPage("/billing?tab=register", { perms: ["accounts_view"] }), false);
  assert.equal(canOpenPage("/billing?tab=register", { perms: ["billing_view"] }), true);
  assert.equal(canOpenPage("/group-report", { perms: ["users"] }), false);
  assert.equal(canOpenPage("/meetings", { perms: [] }), true);
  assert.equal(canOpenPage("/nope", { perms: ["it", "users", "roles"] }), false, "unknown page = closed");
  assert.deepEqual(gateForPage("/health"), { kind: "perm", any: ["health_view", "health_edit"] });
});

test("RBAC: how_to says canDo false (with the no-permission note) for a person without the permission", () => {
  const no = call([], "how_to", { topic: "triage-ticket" }).guides[0];
  assert.equal(no.canDo, false);
  assert.match(no.note, /don't have permission/);
  assert.equal(call(["it"], "how_to", { topic: "triage-ticket" }).guides[0].canDo, true);
  // A guide's extra permission beyond its page: meeting rooms, health edit, billing edit, users.
  assert.equal(call([], "how_to", { topic: "manage-meeting-rooms" }).guides[0].canDo, false);
  assert.equal(call(["meeting_rooms"], "how_to", { topic: "manage-meeting-rooms" }).guides[0].canDo, true);
  assert.equal(call(["health_view"], "how_to", { topic: "add-health-check" }).guides[0].canDo, false);
  assert.equal(call(["billing_view"], "how_to", { topic: "add-billing-charge" }).guides[0].canDo, false);
  assert.equal(call(["roles"], "how_to", { topic: "add-user" }).guides[0].canDo, false);
  assert.equal(call([], "how_to", { topic: "book-meeting-room" }).guides[0].canDo, true);
});

test("explain_screen / where_is: actions the person cannot use carry no link", () => {
  const s = call(["it"], "explain_screen", { path: `${O}/tickets?selected=HC-1` }).screen;
  assert.equal(s.path, "/tickets");
  const del = s.actions.find((a) => a.label === "Delete");
  assert.equal(del.canUse, false);
  assert.equal(del.link, undefined);
  assert.equal(s.actions.find((a) => a.label === "Pick up").link, `${O}/tickets?highlight=Pick%20up`);
  const w = call([], "where_is", { thing: "Add charge" }).results[0];
  assert.equal(w.path, "/billing");
  assert.equal(w.canUse, false);
  assert.equal(call(["billing_edit"], "where_is", { thing: "Add charge" }).results[0].link, `${O}/billing?highlight=Add%20charge`);
});

// ── behaviour ───────────────────────────────────────────────────────────────

test("how_to: finds the right guide from plain words (English, Malay, Chinese)", () => {
  const top = (q) => call(["it"], "how_to", { question: q }).guides[0].id;
  assert.equal(top("how do I open a ticket for someone who called"), "report-it-problem");
  assert.equal(top("book a meeting room"), "book-meeting-room");
  assert.equal(top("reset password for a user"), "manage-user-access");
  assert.equal(top("turn on the morning brief"), "morning-brief-settings");
  assert.equal(top("what is past sla"), "use-sla-view");
  assert.equal(top("订会议室"), "book-meeting-room");
  assert.equal(top("tukar status tiket"), "change-ticket-status");
});

test("how_to: steps carry ?highlight= links and press labels; the id topic returns one guide", () => {
  const g = call(["it"], "how_to", { topic: "report-it-problem" }).guides[0];
  assert.equal(g.link, `${O}/tickets`);
  assert.equal(g.steps[0].link, `${O}/tickets?highlight=New%20ticket`);
  assert.equal(g.steps[0].press, "New ticket");
  assert.equal(g.need, undefined, "internal gate not leaked");
  assert.equal(hubLink(O, "/billing?tab=register", "Add charge"), `${O}/billing?tab=register&highlight=Add%20charge`);
  assert.equal(hubLink(O, "/tickets/:code", "Reply"), null);
});

test("gap log: an unanswered question is logged as no-guide, redacted", () => {
  const o = runHowtoTool(as(["it"]), "how_to", { question: "zzqx frobnicate the wibble for ali@example.com 0123456789" });
  assert.equal(o.note, NO_GUIDE_NOTE);
  assert.doesNotMatch(o.target, /example\.com|0123456789/);
  assert.equal(JSON.parse(o.result.content[0].text).matched, false);
  assert.equal(runHowtoTool(as([]), "glossary", { term: "qwertyuiop" }).note, NO_GUIDE_NOTE);
  assert.equal(runHowtoTool(as([]), "explain_error", { text: "zz yy xx" }).note, NO_GUIDE_NOTE);
  assert.equal(runHowtoTool(as([]), "where_is", { thing: "qqqzzz" }).note, NO_GUIDE_NOTE);
  assert.equal(runHowtoTool(as([]), "glossary", { term: "SLA" }).note, "");
  assert.equal(redactQuestion("mail me at a@b.co or +60 12-345 6789"), "mail me at [email] or [number]");
});

test("explain_error, glossary, module_overview, onboarding answer", () => {
  assert.equal(matchErrors("Error: Someone active must still be able to manage roles")[0].id, "lockout");
  assert.equal(matchErrors("Boardroom can be booked for at most 4 hours at a time.")[0].id, "room-rules");
  assert.match(call([], "glossary", { term: "sla" }).terms[0].definition, /24 hours/);
  const m = call([], "module_overview", { module: "Meetings" }).modules[0];
  assert.equal(m.id, "meetings");
  assert.equal(m.canOpen, true);
  assert.equal(call([], "module_overview", { module: "IT" }).modules[0].canOpen, false);
  const ob = call(["it"], "onboarding", { role: "it-staff" });
  assert.equal(ob.days.length, 5);
  assert.ok(ob.days[0].guides.every((g) => g.title));
  assert.equal(screenForLabels(["Book a room", "Today", "Guest links"]).path, "/meetings");
  assert.equal(screenForPath("/").path, "/tickets");
  assert.equal(whereIs("Pick up")[0].action.label, "Pick up");
});

test("tools: listed for everyone, read-only, wired into routes/mcp.ts and the admin gap log", () => {
  for (const t of HOWTO_TOOLS) {
    assert.ok(Object.hasOwn(TOOL_NEEDS, t.name) && TOOL_NEEDS[t.name] === null, t.name);
    assert.equal(t.annotations.readOnlyHint, true);
  }
  const mcp = readFileSync(join(BACK, "routes/mcp.ts"), "utf8");
  assert.match(mcp, /\.\.\.HOWTO_TOOLS/);
  assert.match(mcp, /isHowtoTool\(name\)\) return runHowtoTool/);
  assert.match(mcp, /\$\{HOWTO_INSTRUCTIONS\}/);
  assert.match(readFileSync(join(BACK, "routes/mcpAdmin.ts"), "utf8"), /WHERE note = \?[\s\S]*NO_GUIDE_NOTE/);
  assert.ok(labelInFrontend("Questions with no guide yet"));
});
