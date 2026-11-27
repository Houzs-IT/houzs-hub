// ---------------------------------------------------------------------------
// proactive.ts — AI Connector round 4d (owner 2026-11-26 「加 全部一起做」): the morning
// brief email (D1), urgent alerts (D2) and the Monday data-gaps section (D4). PURE: no
// database, no network, no imports — routes/proactive.ts reads AS THE PERSON (their own
// daily_brief / tickets_overdue / health_summary / data_gaps answers) and hands them here.
//
//   D1  isBriefDue        is this person's brief due on this tick?
//       buildBriefEmail   English HTML + text: counts and the top 5, each a link; Monday adds data gaps.
//   D2  computeAlerts     an urgent ticket unassigned > 1 hour, a ticket newly past SLA, a
//                         system health check failing (health_view only) — from the person's answers.
//       alertsToSend      the debounce: at most one email per alert key per person per day.
//       buildAlertEmail   one email per tick with every new alert.
//
// Every threshold lives in PROACTIVE_CONFIG (the AI Connector page shows it read-only).
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

/** The ONE place the thresholds live. Shown read-only on the AI Connector page. */
export const PROACTIVE_CONFIG = {
  /** Brief time offered by default (Malaysia time). On the half hour: the check runs twice an hour. */
  briefDefaultTime: "08:00",
  /** A brief not sent within this many hours of its time (the hub was down) is skipped for the day. */
  briefLateCutoffHours: 4,
  /** At most this many briefs are built on one tick; the rest go on the next tick. */
  maxBriefsPerTick: 15,
  alerts: {
    /** An urgent (high-priority) ticket alerts once it has had nobody assigned for this many hours. */
    urgentUnassignedHours: 1,
    /** "Newly" past SLA = at most this many hours over its target (so it alerts once, not every day). */
    newlyPastSlaHours: 24,
    /** Alerts are checked between these Malaysia hours (from inclusive, to exclusive). */
    hoursMyt: { from: 8, to: 20 },
    /** At most this many alert lines per email (the rest are counted). */
    maxLinesPerEmail: 10,
    /** At most this many people are checked on one tick (least recently checked first). */
    maxPeoplePerTick: 15,
  },
} as const;

/** How long one tick may keep starting new people (the rest wait for the next tick). */
export const TICK_BUDGET_MS = 20_000;
/** A person's alerts are not re-checked within this many minutes (two ticks close together). */
export const MIN_ALERT_GAP_MIN = 25;

export type BriefDays = "weekdays" | "daily";
export type Subscription = { userId: number; briefEnabled: boolean; briefTime: string; briefDays: BriefDays; alertsEnabled: boolean };

export const DEFAULT_SUBSCRIPTION: Omit<Subscription, "userId"> = {
  briefEnabled: false,
  briefTime: PROACTIVE_CONFIG.briefDefaultTime,
  briefDays: "weekdays",
  alertsEnabled: false,
};

// ── time (Malaysia, UTC+8, no daylight saving) ──────────────────────────────

export type MytNow = { day: string; hhmm: string; minutes: number; weekday: number };

/** Malaysia wall-clock parts. weekday: 0 = Sunday … 6 = Saturday. */
export function mytNow(nowMs: number = Date.now()): MytNow {
  const m = new Date(nowMs + 8 * 3600_000);
  const hh = m.getUTCHours();
  const mm = m.getUTCMinutes();
  return { day: m.toISOString().slice(0, 10), hhmm: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, minutes: hh * 60 + mm, weekday: m.getUTCDay() };
}

export function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]).filter((x) => x && typeof x === "object") : []);

// ── opt-in ──────────────────────────────────────────────────────────────────

const TIME_RE = /^([01]\d|2[0-3]):(00|30)$/;

/** The settings form → a subscription, or the reason it is refused. Unknown keys are ignored. */
export function parseSubscriptionInput(body: unknown, userId: number): { ok: true; value: Subscription } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send the settings as an object." };
  const b = body as Obj;
  const bool = (k: string, dflt: boolean): boolean | null => (b[k] === undefined ? dflt : typeof b[k] === "boolean" ? (b[k] as boolean) : null);
  const briefEnabled = bool("briefEnabled", DEFAULT_SUBSCRIPTION.briefEnabled);
  const alertsEnabled = bool("alertsEnabled", DEFAULT_SUBSCRIPTION.alertsEnabled);
  if (briefEnabled === null) return { ok: false, error: "briefEnabled must be true or false." };
  if (alertsEnabled === null) return { ok: false, error: "alertsEnabled must be true or false." };
  const briefTime = b.briefTime === undefined ? DEFAULT_SUBSCRIPTION.briefTime : str(b.briefTime);
  if (!TIME_RE.test(briefTime)) return { ok: false, error: "briefTime must be HH:MM on the hour or half hour (Malaysia time), e.g. 08:00 or 07:30." };
  const briefDays = b.briefDays === undefined ? DEFAULT_SUBSCRIPTION.briefDays : str(b.briefDays);
  if (briefDays !== "weekdays" && briefDays !== "daily") return { ok: false, error: "briefDays must be weekdays or daily." };
  return { ok: true, value: { userId, briefEnabled, briefTime, briefDays, alertsEnabled } };
}

/** A database row → a subscription. */
export function subscriptionFromRow(r: Obj): Subscription {
  const time = str(r.brief_time);
  return {
    userId: num(r.user_id),
    briefEnabled: num(r.brief_enabled) === 1 || r.brief_enabled === true,
    briefTime: TIME_RE.test(time) ? time : PROACTIVE_CONFIG.briefDefaultTime,
    briefDays: str(r.brief_days) === "daily" ? "daily" : "weekdays",
    alertsEnabled: num(r.alerts_enabled) === 1 || r.alerts_enabled === true,
  };
}

/**
 * Is the brief due on this tick? Opted in, a wanted day, at or past its time but not more
 * than briefLateCutoffHours past it. "Already sent today" is the store's claim, not this.
 */
export function isBriefDue(sub: Subscription, now: MytNow, cutoffHours: number = PROACTIVE_CONFIG.briefLateCutoffHours): boolean {
  if (!sub.briefEnabled) return false;
  if (sub.briefDays === "weekdays" && (now.weekday === 0 || now.weekday === 6)) return false;
  const m = TIME_RE.exec(sub.briefTime);
  if (!m) return false;
  const at = Number(m[1]) * 60 + Number(m[2]);
  return now.minutes >= at && now.minutes < at + cutoffHours * 60;
}

export function inAlertHours(now: MytNow, hours: { from: number; to: number } = PROACTIVE_CONFIG.alerts.hoursMyt): boolean {
  const h = Math.floor(now.minutes / 60);
  return h >= hours.from && h < hours.to;
}

/** Monday's brief carries the data-gaps list (D4). */
export const isMonday = (now: MytNow): boolean => now.weekday === 1;

/** Who one tick serves: briefs due and not yet sent today, and alert checks in working hours. Both capped. */
export function pickTickWork<T extends Subscription & { lastAlertCheckAt: string }>(subs: T[], now: MytNow, briefedToday: Set<number>, nowMs: number = Date.now()): { briefs: T[]; alerts: T[] } {
  const briefs = subs.filter((s) => isBriefDue(s, now) && !briefedToday.has(s.userId)).slice(0, PROACTIVE_CONFIG.maxBriefsPerTick);
  const alerts = inAlertHours(now)
    ? subs
        .filter((s) => s.alertsEnabled)
        .filter((s) => !s.lastAlertCheckAt || nowMs - Date.parse(s.lastAlertCheckAt) >= MIN_ALERT_GAP_MIN * 60_000)
        .sort((a, b) => (a.lastAlertCheckAt || "").localeCompare(b.lastAlertCheckAt || ""))
        .slice(0, PROACTIVE_CONFIG.alerts.maxPeoplePerTick)
    : [];
  return { briefs, alerts };
}

// ── alerts (D2) ─────────────────────────────────────────────────────────────

export type AlertKind = "urgent" | "sla" | "health";
export type Alert = { key: string; kind: AlertKind; title: string; detail: string; link: string };

/**
 * Today's alert candidates from the person's own answers. A tool the person may not use
 * arrives as null and yields nothing, so an alert never shows what their role cannot see.
 *   overdue: tickets_overdue's answer (urgentUnassigned + pastSla, the Reports page's SLA rule).
 *   health:  health_summary's answer (only fetched for people with health_view).
 */
export function computeAlerts(x: { overdue: unknown; health: unknown; origin: string; cfg?: Partial<typeof PROACTIVE_CONFIG.alerts> }): Alert[] {
  const cfg = { ...PROACTIVE_CONFIG.alerts, ...(x.cfg ?? {}) };
  const out: Alert[] = [];
  const url = (t: Obj) => str(t.url) || `${x.origin}/tickets/${encodeURIComponent(str(t.code))}`;
  if (x.overdue) {
    const o = obj(x.overdue);
    for (const t of arr(obj(o.urgentUnassigned).tickets)) {
      if (!str(t.code) || num(t.hoursUsed) < cfg.urgentUnassignedHours) continue;
      out.push({
        key: `urgent:${str(t.code)}`,
        kind: "urgent",
        title: `${str(t.code)} is urgent and nobody is assigned`,
        detail: [str(t.title), str(t.system), `open ${Math.round(num(t.hoursUsed))} h`].filter(Boolean).join(" · "),
        link: url(t),
      });
    }
    for (const t of arr(obj(o.pastSla).tickets)) {
      const over = num(t.hoursOver);
      if (!str(t.code) || over < 0 || over > cfg.newlyPastSlaHours) continue;
      out.push({
        key: `sla:${str(t.code)}`,
        kind: "sla",
        title: `${str(t.code)} is past its SLA`,
        detail: [str(t.title), str(t.system), `${str(t.priority) || "low"} priority, ${num(t.slaHours)} h target`, str(t.assignee) || "unassigned"].filter(Boolean).join(" · "),
        link: url(t),
      });
    }
  }
  if (x.health) {
    for (const d of arr(obj(x.health).down)) {
      const name = str(d.name);
      if (!name) continue;
      out.push({
        key: `health:${name}`,
        kind: "health",
        title: `${name} is failing its health check`,
        detail: [str(d.system), str(d.error), d.downSince ? `since ${str(d.downSince).slice(0, 16).replace("T", " ")} UTC` : ""].filter(Boolean).join(" · "),
        link: `${x.origin}/health`,
      });
    }
  }
  return out;
}

/** Keys already sent today are dropped (at most one email per alert per person per day). Duplicates too. */
export function alertsToSend(alerts: Alert[], sentToday: Set<string>): Alert[] {
  const seen = new Set<string>();
  return alerts.filter((a) => {
    if (seen.has(a.key) || sentToday.has(a.key)) return false;
    seen.add(a.key);
    return true;
  });
}

// ── emails ──────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const e = (v: unknown) => escapeHtml(str(v));
const FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

type Line = { text: string; link?: string; sub?: string };
type Section = { title: string; count: number | null; lines: Line[]; unavailable?: string; empty?: string };

function shell(title: string, intro: string, body: string, foot: { settingsUrl: string; unsubscribeUrl: string; test?: boolean }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title></head>
<body style="margin:0;background:#F4F5F7;font-family:${FONT};color:#1F2328">
<div style="max-width:640px;margin:0 auto;padding:20px 16px">
${foot.test ? `<div style="background:#FFF4D6;border:1px solid #E8C766;border-radius:8px;padding:8px 12px;font-size:13px;margin-bottom:12px">Test brief: sent only to you, on request.</div>` : ""}
<h1 style="font-size:20px;margin:0 0 4px">${e(title)}</h1>
<p style="margin:0 0 16px;color:#57606A;font-size:14px">${intro}</p>
${body}
<p style="margin:24px 0 0;color:#6E7781;font-size:12px;line-height:1.5">Built from what your own Houzs IT Hub login can see. <a href="${e(foot.settingsUrl)}" style="color:#6E7781">Change these emails</a>${foot.unsubscribeUrl ? ` · <a href="${e(foot.unsubscribeUrl)}" style="color:#6E7781">Unsubscribe</a>` : ""}</p>
</div></body></html>`;
}

function sectionHtml(s: Section): string {
  const head = `<h2 style="font-size:15px;margin:0 0 6px">${e(s.title)}${s.count !== null ? ` <span style="color:#57606A;font-weight:400">(${s.count})</span>` : ""}</h2>`;
  if (s.unavailable) return `<div style="background:#fff;border:1px solid #D0D7DE;border-radius:10px;padding:12px 14px;margin:0 0 12px">${head}<p style="margin:0;color:#57606A;font-size:13px">${e(s.unavailable)}</p></div>`;
  const items = s.lines.length
    ? `<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.5">${s.lines
        .map((l) => `<li>${l.link ? `<a href="${e(l.link)}" style="color:#0969DA">${e(l.text)}</a>` : e(l.text)}${l.sub ? `<br><span style="color:#57606A;font-size:12px">${e(l.sub)}</span>` : ""}</li>`)
        .join("")}</ul>`
    : `<p style="margin:0;color:#57606A;font-size:13px">${e(s.empty ?? "Nothing here.")}</p>`;
  return `<div style="background:#fff;border:1px solid #D0D7DE;border-radius:10px;padding:12px 14px;margin:0 0 12px">${head}${items}</div>`;
}

function sectionText(s: Section): string {
  if (s.unavailable) return `${s.title}: ${s.unavailable}`;
  const head = `${s.title}${s.count !== null ? ` (${s.count})` : ""}`;
  return [head, ...(s.lines.length ? s.lines.map((l) => `- ${l.text}${l.link ? ` ${l.link}` : ""}`) : [`- ${s.empty ?? "Nothing here."}`])].join("\n");
}

const ticketLine = (t: Obj): Line => ({
  text: `${str(t.code)} ${str(t.title)}`.trim(),
  link: str(t.url) || undefined,
  sub: [str(t.system), str(t.priority) && `${str(t.priority)} priority`, str(t.status).replace(/_/g, " "), t.ageDays !== undefined ? `${num(t.ageDays)} d old` : ""].filter(Boolean).join(" · "),
});

/** One daily_brief part → a section ({unavailable} when the person may not read it). */
function briefSection(title: string, part: unknown, line: (x: Obj) => Line, empty: string): Section {
  const p = obj(part);
  if (typeof p.unavailable === "string") return { title, count: null, lines: [], unavailable: p.unavailable };
  return { title, count: num(p.count), lines: arr(p.top).slice(0, 5).map(line), empty };
}

const gapCount = (v: unknown): number => num(obj(v).total);

/** data_gaps → one section per area, a line per gap with a count (no names: counts and a link). */
export function gapSections(gaps: unknown, origin: string): Section[] {
  const g = obj(gaps);
  const out: Section[] = [];
  const area = (title: string, part: unknown, rows: [string, string][], link: string) => {
    const p = obj(part);
    if (typeof p.unavailable === "string") return; // no access → left out of the brief
    const found = rows.map(([k, label]) => ({ label, n: gapCount(p[k]) })).filter((r) => r.n > 0);
    out.push({ title, count: found.reduce((a, r) => a + r.n, 0), lines: found.map((r) => ({ text: `${r.label}: ${r.n}`, link })), empty: "Nothing missing." });
  };
  area("Data gaps: tickets", g.tickets, [["noAssignee", "Open tickets with no assignee"], ["noModule", "Open tickets with no module"]], `${origin}/tickets`);
  area(
    "Data gaps: system billing",
    g.billing,
    [
      ["noAmount", "Active charges with no amount"],
      ["noCard", "Active charges with no card"],
      ["noSystem", "Active charges with no system"],
      ["noAccount", "Active charges with no account"],
      ["neverChecked", "Charges never checked"],
      ["notConfirmed", "Charges still to confirm"],
    ],
    `${origin}/billing`,
  );
  area(
    "Data gaps: account ownership",
    g.accounts,
    [
      ["noMainOwner", "Accounts with no main owner"],
      ["noItAccess", "Accounts with no IT access"],
      ["noBillsTo", "Accounts with no bills-to"],
    ],
    `${origin}/billing?tab=accounts`,
  );
  return out;
}

/** The morning brief email from the person's own daily_brief (and data_gaps on Monday). */
export function buildBriefEmail(x: { brief: unknown; gaps: unknown | null; name: string; date: string; origin: string; settingsUrl: string; unsubscribeUrl: string; test?: boolean }) {
  const b = obj(x.brief);
  const sections: Section[] = [
    briefSection("My open tickets", b.myOpenTickets, ticketLine, "No open tickets assigned to you."),
    briefSection("Urgent tickets nobody is assigned to", b.unassignedHighPriority, ticketLine, "None."),
    briefSection("My meetings today", b.myMeetingsToday, (m) => ({ text: `${str(m.time)} ${str(m.title)}`.trim(), link: `${x.origin}/meetings`, sub: str(m.organizer) ? `organised by ${str(m.organizer)}` : undefined }), "No meetings today."),
    briefSection(
      "Unread notifications",
      b.unreadNotifications,
      (n) => ({ text: `${str(n.ticket)} ${str(n.title)}`.trim(), link: str(n.ticket) ? `${x.origin}/tickets/${encodeURIComponent(str(n.ticket))}` : `${x.origin}/notifications`, sub: [str(n.what).replace(/_/g, " "), str(n.by)].filter(Boolean).join(" · ") }),
      "Nothing unread.",
    ),
  ];
  const mine = obj(b.myOpenTickets);
  if (typeof mine.unavailable !== "string" && (num(mine.highPriority) || num(mine.openOver7Days))) {
    sections[0]!.lines.unshift({ text: `${num(mine.highPriority)} high priority · ${num(mine.openOver7Days)} open over 7 days · ${num(mine.waitingOnReporter)} waiting on the reporter` });
  }
  const gaps = x.gaps ? gapSections(x.gaps, x.origin) : [];
  const all = [...sections, ...gaps];
  const items = sections.reduce((a, s) => a + (s.count ?? 0), 0);
  const subject = `${x.test ? "[Test] " : ""}Your IT Hub brief for ${x.date}: ${items} item${items === 1 ? "" : "s"}`;
  const intro = `Good morning${x.name ? `, ${e(x.name)}` : ""}. Here is what needs you today${gaps.length ? ", plus this week's data gaps" : ""}.`;
  const html = shell(`IT Hub brief, ${x.date}`, intro, all.map(sectionHtml).join("\n"), x);
  const text = [`IT Hub brief, ${x.date}`, "", ...all.map(sectionText).flatMap((t) => [t, ""]), `Change these emails: ${x.settingsUrl}`, x.unsubscribeUrl ? `Unsubscribe: ${x.unsubscribeUrl}` : ""].join("\n").trim();
  return { subject, html, text, items };
}

const KIND_TITLE: Record<AlertKind, string> = { urgent: "Urgent tickets with nobody assigned", sla: "Tickets newly past their SLA", health: "Systems failing their health check" };

/** One email with every new alert of this tick (capped lines, the rest counted). */
export function buildAlertEmail(x: { alerts: Alert[]; name: string; date: string; settingsUrl: string; unsubscribeUrl: string; maxLines?: number }) {
  const max = x.maxLines ?? PROACTIVE_CONFIG.alerts.maxLinesPerEmail;
  const shown = x.alerts.slice(0, max);
  const sections: Section[] = (["health", "urgent", "sla"] as AlertKind[])
    .map((k) => ({ title: KIND_TITLE[k], count: x.alerts.filter((a) => a.kind === k).length, lines: shown.filter((a) => a.kind === k).map((a) => ({ text: a.title, link: a.link, sub: a.detail })) }))
    .filter((s) => s.count > 0);
  const more = x.alerts.length - shown.length;
  const first = x.alerts[0];
  const subject = `IT Hub alert: ${first ? first.title : "nothing new"}${x.alerts.length > 1 ? ` and ${x.alerts.length - 1} more` : ""}`;
  const body = sections.map(sectionHtml).join("\n") + (more > 0 ? `<p style="font-size:13px;color:#57606A">And ${more} more: open the hub to see them all.</p>` : "");
  const html = shell("IT Hub alert", `${x.name ? `${e(x.name)}, ` : ""}${x.alerts.length} new alert${x.alerts.length === 1 ? "" : "s"} on ${e(x.date)}. Each alert is sent at most once a day.`, body, x);
  const text = [`IT Hub alert, ${x.date}`, "", ...sections.map(sectionText).flatMap((t) => [t, ""]), more > 0 ? `And ${more} more.` : "", `Change these emails: ${x.settingsUrl}`, x.unsubscribeUrl ? `Unsubscribe: ${x.unsubscribeUrl}` : ""].filter((l, i, a) => l || a[i - 1]).join("\n").trim();
  return { subject, html, text };
}

/** The thresholds in words, for the settings page. */
export function thresholdsForDisplay(): string[] {
  const a = PROACTIVE_CONFIG.alerts;
  return [
    `An urgent (high-priority) ticket with nobody assigned for more than ${a.urgentUnassignedHours} hour.`,
    `A ticket newly past its SLA (the Reports page's rule: high 24 h, medium 3 days, low 7 days), up to ${a.newlyPastSlaHours} hours after it passed.`,
    "A system failing its health check (only if you may see System health).",
    `Alerts are checked ${a.hoursMyt.from}:00 to ${a.hoursMyt.to}:00 Malaysia time, about every 30 minutes; each alert is emailed at most once a day.`,
    `The morning brief goes out at your time (or up to ${PROACTIVE_CONFIG.briefLateCutoffHours} hours late if the hub was down). Monday's brief adds the data gaps.`,
  ];
}
