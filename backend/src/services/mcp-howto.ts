// ---------------------------------------------------------------------------
// AI Connector round 5: process help ("how do I…"). Pure: no reads, no writes.
// routes/mcp.ts calls runHowtoTool and logs the outcome; a question no guide
// answers is logged with note NO_GUIDE_NOTE and listed on the AI Connector
// admin page ("Questions with no guide yet").
//
// Tools: how_to, module_overview, glossary, explain_error, onboarding,
// explain_screen, where_is. canDo / canOpen come from the person's own hub
// permissions (mcp-howto-types.ts PAGE_GATES mirrors the portal).
// Value imports use .ts so node --test can load this file directly.
// ---------------------------------------------------------------------------
import { TICKET_GUIDES } from "./mcp-howto-guides-tickets.ts";
import { HUB_GUIDES } from "./mcp-howto-guides-hub.ts";
import { GLOSSARY, MODULES, ONBOARDING } from "./mcp-howto-reference.ts";
import { ERRORS } from "./mcp-howto-errors.ts";
import { SCREENS, type Screen } from "./mcp-howto-screens.ts";
import { canOpenPage, gatePasses, hubLink, NO_PERMISSION_NOTE, type HowtoGuide, type HowtoUser } from "./mcp-howto-types.ts";

export const HOWTO_GUIDES: HowtoGuide[] = [...TICKET_GUIDES, ...HUB_GUIDES];

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
/** What a help tool hands back to routes/mcp.ts: the result plus what goes into mcp_calls. */
export type HowtoOutcome = { result: ToolResult; status: number; note: string; target: string };
/** The person and the public origin links are built on. Help tools read no hub data. */
export type HowtoCtx = { user: HowtoUser; origin: string };

/** The mcp_calls note on a question no guide answers; the admin page lists these. */
export const NO_GUIDE_NOTE = "no-guide";

const STOP = new Set(["how", "to", "do", "does", "i", "a", "an", "the", "in", "on", "for", "of", "my", "me", "is", "are", "what", "where", "can", "we", "you", "and", "or", "with", "hub", "please", "help", "want", "need", "it", "this", "that", "be", "get", "should", "who", "when", "which", "macam", "mana", "cara", "saya", "nak", "untuk", "dan", "yang"]);

const norm = (s: string): string => s.normalize("NFKC").toLowerCase();
const wordsOf = (s: string): string[] => norm(s).match(/[a-z0-9@]+/g) ?? [];

/** The latin words (stop words dropped) and the CJK runs of a question. "IT" in capitals stays a word. */
export function queryTerms(q: string): { words: string[]; cjk: string[]; text: string } {
  const text = norm(q);
  const words = wordsOf(text).filter((w) => w.length >= 2 && !STOP.has(w));
  if (/\bIT\b/.test(q)) words.push("it");
  const cjk = text.match(/[㐀-鿿]+/g) ?? [];
  return { words, cjk, text };
}

type Rankable = { id: string; title: string; keywords: readonly string[] };

/** Keyword / title score: whole keyword phrases count most, then shared words. No external calls. */
export function scoreItem(item: Rankable, q: ReturnType<typeof queryTerms>): number {
  if (!q.words.length && !q.cjk.length) return 0;
  let score = 0;
  const qWords = new Set(q.words);
  const padded = ` ${(q.text.match(/[a-z0-9@㐀-鿿]+/g) ?? []).join(" ")} `;
  for (const raw of item.keywords) {
    const k = norm(raw);
    if (/[㐀-鿿]/.test(k)) {
      if (q.text.includes(k)) score += 4 + k.length;
      continue;
    }
    const kw = wordsOf(k);
    if (kw.length && padded.includes(` ${kw.join(" ")} `)) score += 3 + kw.length * 2;
    else score += kw.filter((w) => qWords.has(w)).length * 0.75;
  }
  const titleWords = new Set(wordsOf(item.title));
  for (const w of qWords) if (titleWords.has(w)) score += 2;
  if (qWords.has(norm(item.id))) score += 50;
  return score;
}

/** Items ranked best first, zero scores dropped. */
export function rank<T extends Rankable>(items: readonly T[], question: string): { item: T; score: number }[] {
  const q = queryTerms(question);
  return items
    .map((item) => ({ item, score: scoreItem(item, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** A question with emails and long digit runs removed, cut to 80 characters, for the no-guide log. */
export function redactQuestion(q: string): string {
  return q
    .replace(/[^\s@]+@[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{5,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
const answer = (v: unknown, target: string, note = ""): HowtoOutcome => ({ result: text(JSON.stringify(v)), status: 200, note, target });
const str = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 300) : "");

/** May this person do the guide: open its page and hold any extra permission it needs. */
export const canDoGuide = (g: HowtoGuide, u: HowtoUser): boolean => canOpenPage(g.page, u) && (!g.need || gatePasses(g.need, u));

/** One guide as the tool returns it: links built, gate replaced by canDo for this person. */
export function guideView(g: HowtoGuide, ctx: HowtoCtx) {
  const canDo = canDoGuide(g, ctx.user);
  const { steps, need: _need, ...rest } = g;
  return {
    ...rest,
    link: hubLink(ctx.origin, g.page, null),
    canDo,
    ...(canDo ? {} : { note: NO_PERMISSION_NOTE }),
    steps: steps.map((s, i) => ({
      n: i + 1,
      ...(s.role ? { role: s.role } : {}),
      do: s.do,
      ...(s.check ? { check: s.check } : {}),
      ...(s.then ? { then: s.then } : {}),
      ...(s.page ? { link: hubLink(ctx.origin, s.page, s.highlight) ?? s.page } : {}),
      ...(s.highlight ? { press: s.highlight } : {}),
    })),
  };
}

const byId = new Map(HOWTO_GUIDES.map((g) => [g.id, g]));
const titleList = () => HOWTO_GUIDES.map((g) => ({ id: g.id, title: g.title, kind: g.kind }));

function howTo(ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const topic = str(args.topic);
  const question = str(args.question);
  const exact = topic ? byId.get(topic) : undefined;
  if (exact) return answer({ guides: [guideView(exact, ctx)] }, `how_to ${exact.id}`);
  const asked = [question, topic].filter(Boolean).join(" ");
  const hits = rank(HOWTO_GUIDES, asked);
  if (!hits.length) {
    return answer({ matched: false, message: "No guide matches that question yet. These are the guides there are:", guides: titleList() }, asked ? redactQuestion(asked) : "how_to (empty)", asked ? NO_GUIDE_NOTE : "");
  }
  const top = hits[0].score;
  const full = hits.filter((h, i) => i === 0 || h.score >= top * 0.8).slice(0, 3);
  const more = hits.filter((h) => !full.includes(h)).slice(0, 4).map((h) => ({ id: h.item.id, title: h.item.title }));
  return answer({ guides: full.map((h) => guideView(h.item, ctx)), ...(more.length ? { alsoSee: more } : {}), tip: "Call how_to with topic = an id for another guide." }, `how_to ${full.map((h) => h.item.id).join(",")}`);
}

const moduleOpen = (m: (typeof MODULES)[number], u: HowtoUser): boolean => m.keyPages.some((p) => canOpenPage(p.path, u));

function moduleOverview(ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const asked = str(args.module);
  if (!asked) return answer({ modules: MODULES.map((m) => ({ id: m.id, name: m.name, sidebar: m.sidebar, purpose: m.purpose.split(/(?<=\.)\s/)[0], canOpen: moduleOpen(m, ctx.user) })) }, "module_overview (list)");
  const exact = MODULES.find((m) => m.id === norm(asked) || norm(m.name) === norm(asked) || norm(m.sidebar) === norm(asked));
  const hits = exact ? [exact] : rank(MODULES.map((m) => ({ ...m, title: `${m.name} ${m.sidebar}` })), asked).slice(0, 2).map((h) => MODULES.find((m) => m.id === h.item.id) ?? h.item);
  if (!hits.length) return answer({ matched: false, message: "No module by that name. These are the modules:", modules: MODULES.map((m) => ({ id: m.id, name: m.name })) }, redactQuestion(asked), NO_GUIDE_NOTE);
  return answer(
    {
      modules: hits.map((m) => {
        const canOpen = moduleOpen(m, ctx.user);
        const { keyPages, ...rest } = m;
        return { ...rest, canOpen, ...(canOpen ? {} : { note: NO_PERMISSION_NOTE }), keyPages: keyPages.map((p) => ({ ...p, canOpen: canOpenPage(p.path, ctx.user), link: hubLink(ctx.origin, p.path, null) ?? p.path })) };
      }),
    },
    `module_overview ${hits.map((m) => m.id).join(",")}`,
  );
}

function glossary(ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const asked = str(args.term);
  if (!asked) return answer({ terms: GLOSSARY.map((t) => t.term) }, "glossary (list)");
  const exact = GLOSSARY.filter((t) => norm(t.term) === norm(asked) || t.aliases.some((a) => norm(a) === norm(asked)));
  const hits = exact.length ? exact : rank(GLOSSARY.map((t) => ({ ...t, id: t.term, title: [t.term, ...t.aliases].join(" "), keywords: [t.term, ...t.aliases, ...t.keywords] })), asked).slice(0, 3).map((h) => h.item);
  if (!hits.length) return answer({ matched: false, message: "That term is not in the glossary yet. Known terms:", terms: GLOSSARY.map((t) => t.term) }, redactQuestion(asked), NO_GUIDE_NOTE);
  return answer({ terms: hits.map((t) => ({ term: t.term, aliases: t.aliases, definition: t.definition, seeAlso: t.seeAlso, ...(t.page ? { link: hubLink(ctx.origin, t.page, null) } : {}) })) }, `glossary ${hits.map((t) => t.term).join(",")}`);
}

/** The error entries whose backend text appears in what the person pasted, longest match first; then a word-overlap fallback. */
export function matchErrors(pasted: string) {
  const t = norm(pasted);
  const direct = ERRORS.map((e) => ({ e, len: Math.max(0, ...e.match.map((m) => (t.includes(norm(m)) ? m.length : 0))) }))
    .filter((x) => x.len > 0)
    .sort((a, b) => b.len - a.len)
    .map((x) => x.e);
  if (direct.length) return direct.slice(0, 2);
  const words = new Set(queryTerms(pasted).words);
  return ERRORS.map((e) => {
    const best = Math.max(
      ...e.match.map((m) => {
        const mw = wordsOf(m).filter((w) => !STOP.has(w));
        return mw.length ? mw.filter((w) => words.has(w)).length / mw.length : 0;
      }),
    );
    return { e, best };
  })
    .filter((x) => x.best >= 0.6)
    .sort((a, b) => b.best - a.best)
    .slice(0, 2)
    .map((x) => x.e);
}

function explainError(args: Record<string, unknown>): HowtoOutcome {
  const pasted = str(args.text);
  if (!pasted) return { result: text("Paste the error message text (exactly as the hub shows it).", true), status: 400, note: "", target: "explain_error" };
  const hits = matchErrors(pasted);
  if (!hits.length) return answer({ matched: false, message: "This message is not in the error guide yet. Read it to the person in plain words, and if it blocks them ask them to log an IT ticket with a screenshot." }, redactQuestion(pasted), NO_GUIDE_NOTE);
  return answer({ errors: hits.map(({ id, module, meaning, cause, fix }) => ({ id, module, meaning, cause, fix })) }, `explain_error ${hits.map((e) => e.id).join(",")}`);
}

function onboarding(ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const asked = str(args.role);
  if (!asked) return answer({ roles: ONBOARDING.map((o) => ({ role: o.role, title: o.title })) }, "onboarding (list)");
  const exact = ONBOARDING.find((o) => o.role === norm(asked));
  const ranked = rank(ONBOARDING.map((o) => ({ ...o, id: o.role, keywords: [o.role, ...o.keywords] })), asked);
  const hit = exact ?? (ranked.length ? ranked[0].item : undefined);
  if (!hit) return answer({ matched: false, message: "No first-week path for that role. Roles:", roles: ONBOARDING.map((o) => o.role) }, redactQuestion(asked), NO_GUIDE_NOTE);
  return answer(
    {
      role: hit.role,
      title: hit.title,
      contact: hit.contact,
      days: hit.days.map((d) => ({
        day: d.day,
        goals: d.goals,
        guides: d.guides.map((id) => {
          const g = byId.get(id);
          return g ? { id, title: g.title, canDo: canDoGuide(g, ctx.user) } : { id };
        }),
        pages: d.pages.map((p) => ({ path: p, canOpen: canOpenPage(p, ctx.user), link: hubLink(ctx.origin, p, null) ?? p })),
      })),
      tip: "Call how_to with topic = a guide id for its full steps.",
    },
    `onboarding ${hit.role}`,
  );
}

// ── screen map: explain_screen, where_is ────────────────────────────────────

const segMatch = (route: string, path: string): boolean => {
  const r = route.split("/");
  const p = path.split("/");
  return r.length === p.length && r.every((s, i) => s.startsWith(":") || s === p[i]);
};

/** The screen for a path or full URL (query and origin ignored). */
export function screenForPath(raw: string): Screen | null {
  const path = raw.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/") return SCREENS.find((s) => s.path === "/tickets") ?? null;
  return SCREENS.find((s) => s.path === path) ?? SCREENS.find((s) => segMatch(s.path, path)) ?? null;
}

/** The screen whose buttons / tabs / parts best match labels read off a screenshot. */
export function screenForLabels(labels: string[]): Screen | null {
  const want = new Set(labels.map((l) => norm(l).trim()).filter(Boolean));
  if (!want.size) return null;
  let best: { s: Screen; n: number } | null = null;
  for (const s of SCREENS) {
    const have = new Set([s.title, ...s.actions.map((a) => a.label), ...s.tabs, ...s.parts.map((p) => p.name)].map(norm));
    const n = [...want].filter((w) => have.has(w)).length;
    if (n && (!best || n > best.n)) best = { s, n };
  }
  return best?.s ?? null;
}

function screenView(s: Screen, ctx: HowtoCtx) {
  const page = s.path;
  const canOpen = canOpenPage(page, ctx.user);
  return {
    title: s.title,
    path: page,
    sidebar: s.sidebar,
    purpose: s.purpose,
    canOpen,
    ...(canOpen ? {} : { note: NO_PERMISSION_NOTE }),
    link: hubLink(ctx.origin, page, null),
    parts: s.parts,
    tabs: s.tabs,
    actions: s.actions.map((a) => {
      const canUse = canOpen && (!a.need || gatePasses(a.need, ctx.user));
      return { label: a.label, what: a.what, canUse, ...(a.guide ? { guide: a.guide } : {}), ...(canUse ? { link: hubLink(ctx.origin, page, a.label) } : {}) };
    }),
  };
}

function explainScreen(ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const path = str(args.path);
  const labels = Array.isArray(args.labels) ? args.labels.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 80)).slice(0, 30) : [];
  const s = (path ? screenForPath(path) : null) ?? screenForLabels(labels);
  const asked = path || labels.join(", ");
  if (!s) return answer({ matched: false, message: "I don't recognise that screen. These are the hub's screens:", screens: SCREENS.map((x) => ({ title: x.title, path: x.path })) }, redactQuestion(asked || "explain_screen"), asked ? NO_GUIDE_NOTE : "");
  return answer({ screen: screenView(s, ctx) }, `explain_screen ${s.path}`);
}

/** Where a button, tab or page is: best matches across the screen map. */
export function whereIs(thing: string): { screen: Screen; action: { label: string; what: string } | null; score: number }[] {
  const q = queryTerms(thing);
  const out: { screen: Screen; action: { label: string; what: string } | null; score: number }[] = [];
  for (const s of SCREENS) {
    const sScore = scoreItem({ id: s.path, title: s.title, keywords: [s.title, s.sidebar, ...s.keywords] }, q);
    if (sScore > 0) out.push({ screen: s, action: null, score: sScore });
    for (const a of [...s.actions, ...s.tabs.map((t) => ({ label: t, what: `Tab on ${s.title}` }))]) {
      const exact = norm(a.label) === norm(thing.trim());
      const aScore = exact ? 100 : scoreItem({ id: a.label, title: a.label, keywords: [a.label] }, q);
      if (aScore > 0) out.push({ screen: s, action: a, score: aScore + 1 });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

function whereIsTool(ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const thing = str(args.thing);
  if (!thing) return { result: text("Say what you are looking for, e.g. \"Pick up\" or \"meeting rooms\".", true), status: 400, note: "", target: "where_is" };
  const hits = whereIs(thing);
  if (!hits.length) return answer({ matched: false, message: "Not found in the screen map. These are the hub's screens:", screens: SCREENS.map((x) => ({ title: x.title, path: x.path, sidebar: x.sidebar })) }, redactQuestion(thing), NO_GUIDE_NOTE);
  return answer(
    {
      results: hits.map((h) => {
        const canOpen = canOpenPage(h.screen.path, ctx.user);
        const action = h.action ? h.screen.actions.find((a) => a.label === h.action!.label) : undefined;
        const canUse = canOpen && (!action?.need || gatePasses(action.need, ctx.user));
        return {
          screen: h.screen.title,
          path: h.screen.path,
          sidebar: h.screen.sidebar,
          ...(h.action ? { label: h.action.label, what: h.action.what } : { what: h.screen.purpose.split(/(?<=\.)\s/)[0] }),
          canUse,
          ...(canUse ? { link: hubLink(ctx.origin, h.screen.path, h.action?.label) } : { note: NO_PERMISSION_NOTE }),
        };
      }),
    },
    `where_is ${hits[0].screen.path}${hits[0].action ? ` ${hits[0].action.label}` : ""}`.slice(0, 200),
  );
}

const readOnly = { readOnlyHint: true, openWorldHint: false };

/** The help tools (no hub data read; canDo comes from the person's own hub permissions). */
export const HOWTO_TOOLS = [
  {
    name: "how_to",
    title: "How do I ... (step-by-step hub guide)",
    description:
      "Step-by-step SOP for doing something in the IT Hub: report an IT problem / log a ticket, find tickets, triage and pick up, assign, change status, reply to the reporter or add an internal note, close / reject / delete, the SLA and Reports page, notifications, book a meeting room, guest booking links, meeting rooms, system health, system billing, statements and invoices, account ownership, connect Claude / ChatGPT, morning brief, AI Connector admin, the group report, add users, roles and permissions, my account; and whole flows (a ticket from report to closed, setting up a new IT staff member). Returns the top 1-3 guides: purpose, prerequisites, fields, click-by-click steps with links that highlight the button to press, checks, warnings, undo, common mistakes, and canDo for this person. Guides are English; translate for the person.",
    inputSchema: { type: "object", properties: { question: { type: "string", description: "The person's question in their own words (any language)" }, topic: { type: "string", description: "A guide id from an earlier answer" } }, additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "module_overview",
    title: "What a hub module is for",
    description: "What a part of the hub is for (IT tickets, Meetings, System billing, System health, Users and roles, AI Connector, My account), its key pages with links, who uses it and how it connects. Leave out module for the list.",
    inputSchema: { type: "object", properties: { module: { type: "string", description: "Module or sidebar label, e.g. IT, Meetings, System billing" } }, additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "glossary",
    title: "What does this hub term mean",
    description: "Plain-English meaning of a hub term (SLA, priority, module, system, status, Waiting Reporter, Done, pick up, walk-in ticket, internal note, role, permission, override, integration, charge, statement line, AI actions, morning brief, group report ...). Leave out term for the list.",
    inputSchema: { type: "object", properties: { term: { type: "string" } }, additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "explain_error",
    title: "Explain a hub error message",
    description: "The meaning, cause and fix of an error or validation message the hub showed. Pass the message text exactly as shown (read it off a screenshot if needed).",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "The error text" } }, required: ["text"], additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "onboarding",
    title: "First-week path for a new staff member",
    description: "A day-by-day first-week learning path for a role (it-staff, it-manager, admin, finance) with the guides and pages to practise. Leave out role for the list.",
    inputSchema: { type: "object", properties: { role: { type: "string" } }, additionalProperties: false },
    annotations: readOnly,
  },
  {
    name: "explain_screen",
    title: "Explain this hub screen",
    description: "What a hub screen is for, its parts, its buttons and tabs (with links that highlight each one) and which ones this person can use. Pass path (or the URL) of the page, or labels read off a screenshot (button / tab / heading texts).",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Page path or URL, e.g. /tickets or https://.../reports" }, labels: { type: "array", items: { type: "string" }, description: "Visible labels from a screenshot" } },
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "where_is",
    title: "Where is this in the hub",
    description: "Where to find a button, tab or page (e.g. Pick up, Add charge, meeting rooms, morning brief): the page, the sidebar path and a link that highlights it, if this person may use it.",
    inputSchema: { type: "object", properties: { thing: { type: "string", description: "The button, tab or page, in the person's words" } }, required: ["thing"], additionalProperties: false },
    annotations: readOnly,
  },
] as const;

const NAMES = new Set<string>(HOWTO_TOOLS.map((t) => t.name));
/** Is this one of the help tools? */
export const isHowtoTool = (name: string): boolean => NAMES.has(name);

/** Run a help tool. Pure: no reads, no writes; routes/mcp.ts logs the outcome. */
export function runHowtoTool(ctx: HowtoCtx, name: string, args: Record<string, unknown>): HowtoOutcome {
  switch (name) {
    case "how_to":
      return howTo(ctx, args);
    case "module_overview":
      return moduleOverview(ctx, args);
    case "glossary":
      return glossary(ctx, args);
    case "explain_error":
      return explainError(args);
    case "onboarding":
      return onboarding(ctx, args);
    case "explain_screen":
      return explainScreen(ctx, args);
    case "where_is":
      return whereIsTool(ctx, args);
    default:
      return { result: text(`Unknown tool: ${name}`, true), status: 400, note: "", target: name };
  }
}

/** The help part of the server instructions. */
export const HOWTO_INSTRUCTIONS = `HELP (no hub data, always available): "how do I / where do I / steps to ..." -> how_to {question}; give the steps in the person's language, keep the quoted button names in English as the screen shows them, and give each step's link (it highlights the button). If canDo is false say: you don't have permission for this in the hub — ask your IT admin. "What is this screen" -> explain_screen {path or labels}; "where is X" -> where_is {thing}; "what is module X" -> module_overview; "what does X mean" -> glossary; an error message -> explain_error {text}; a new staff member -> onboarding {role}.`;

/** Ready-made prompts for the help tools. */
export const HOWTO_PROMPTS = [
  { name: "how_do_i", title: "How do I ...", description: "Step-by-step guide for a hub task. Uses how_to.", arguments: [{ name: "task", description: "What you want to do, e.g. book a meeting room", required: true }] },
  { name: "explain_this_error", title: "Explain this error", description: "What a hub error means and how to fix it. Uses explain_error.", arguments: [{ name: "error", description: "The error text", required: true }] },
  { name: "my_first_week", title: "My first week", description: "A first-week learning path for a role. Uses onboarding.", arguments: [{ name: "role", description: "it-staff, it-manager, admin or finance", required: false }] },
] as const;

/** The message for a help prompt, or null for a name that is not one. */
export function howtoPromptText(name: string, a: Record<string, unknown>): string | null {
  const v = (k: string) => (typeof a[k] === "string" ? (a[k] as string).trim().slice(0, 200) : "");
  const close = " Answer in my language, keep button names as the screen shows them, and give the links.";
  switch (name) {
    case "how_do_i":
      return `How do I ${v("task") || "do this"} in the IT Hub? Call how_to {question: "${v("task")}"} and walk me through it step by step, with what to fill, what to check before confirming and what happens after.${close}`;
    case "explain_this_error":
      return `The hub showed this error: "${v("error")}". Call explain_error {text} and tell me what it means, why it happened and how to fix it.${close}`;
    case "my_first_week":
      return `I am new. Call onboarding${v("role") ? ` {role: "${v("role")}"}` : ""} and give me my first-week plan, day by day.${close}`;
    default:
      return null;
  }
}
