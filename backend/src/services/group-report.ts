// ---------------------------------------------------------------------------
// group-report.ts — the group monthly report (AI Connector round 4d D3, owner 2026-11-26).
// PURE: no imports, no network. routes/groupReport.ts calls each system's own
// `company_report` tool through that system's MCP connector, AS THE ADMIN who connected it
// (his grant, his RBAC there), and hands the answers here.
//
//   GROUP_SYSTEMS      the connectors, and the company_report calls per system with each
//                      system's own argument names (checked in each repo, 2026-11-27).
//   normalise          one answer → the same metrics with the same definitions everywhere.
//   buildGroupReport   group summary first (each figure vs the previous month), then one
//                      section per company; a system not connected / no access says so.
//   renderReportHtml   one self-contained, email-safe HTML page.
//   monthlyDue         the 1st of the month from 09:00 Malaysia time → last month's report.
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

export type CompanyCall = { company: string; args: (month: string) => Obj; shape: Shape };
export type GroupSystem = { key: string; name: string; mcpUrl: string; calls: CompanyCall[] };
export type Shape = "hookka" | "houzs" | "conts" | "dream_crafter" | "hris";

/**
 * The systems and their company_report arguments, for one named month YYYY-MM:
 *   Hookka  {period: "month", month}                        (src/api/routes/mcp.ts)
 *   Houzs   {period: "YYYY-MM", company?: "2990"}           (backend/src/services/mcp-round4.ts)
 *   Conts   {period: "month", month, company?}              (functions/_lib/mcpConts4Tools.ts)
 *   HRIS    {period: "YYYY-MM"} → every company the role sees (src/routes/mcp.ts)
 */
export const GROUP_SYSTEMS: GroupSystem[] = [
  { key: "hookka", name: "Hookka", mcpUrl: "https://erp.hookka.com/api/mcp", calls: [{ company: "Hookka", shape: "hookka", args: (m) => ({ period: "month", month: m }) }] },
  {
    key: "houzs",
    name: "Houzs ERP",
    mcpUrl: "https://erp.houzscentury.com/api/mcp",
    calls: [
      { company: "Houzs Century", shape: "houzs", args: (m) => ({ period: m }) },
      { company: "2990s", shape: "houzs", args: (m) => ({ period: m, company: "2990" }) },
    ],
  },
  {
    key: "conts",
    name: "The Conts ERP",
    mcpUrl: "https://erp.theconts.com/api/mcp",
    calls: [
      { company: "The Conts", shape: "conts", args: (m) => ({ period: "month", month: m }) },
      { company: "Dream Crafter", shape: "dream_crafter", args: (m) => ({ period: "month", month: m, company: "Dream Crafter" }) },
    ],
  },
  { key: "hris", name: "HRIS", mcpUrl: "https://api.hris.houzscentury.com/mcp", calls: [{ company: "People (HRIS, every company)", shape: "hris", args: (m) => ({ period: m }) }] },
];

export const systemByKey = (key: string): GroupSystem | undefined => GROUP_SYSTEMS.find((s) => s.key === key);

// ── helpers ─────────────────────────────────────────────────────────────────

const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]).filter((x) => x && typeof x === "object") : []);
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
/** A number only when the system sent one: missing / null / not a number = not available. */
const n = (v: unknown): number | null => (v === null || v === undefined || v === "" || typeof v === "object" || !Number.isFinite(Number(v)) ? null : Number(v));

const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const isMonth = (m: unknown): m is string => typeof m === "string" && YM.test(m);

export function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const i = y * 12 + (m - 1) + by;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

const mytParts = (nowMs: number) => {
  const d = new Date(nowMs + 8 * 3600_000);
  return { ym: d.toISOString().slice(0, 7), day: d.getUTCDate(), hour: d.getUTCHours() };
};

/** The month a manual build may ask for: a whole month up to this one (Malaysia time). */
export function validReportMonth(m: unknown, nowMs: number = Date.now()): m is string {
  return isMonth(m) && m <= mytParts(nowMs).ym && m >= "2020-01";
}

/** The scheduled report: on the 1st of the month from 09:00 Malaysia time, last month; else null. */
export function monthlyDue(nowMs: number = Date.now()): string | null {
  const p = mytParts(nowMs);
  return p.day === 1 && p.hour >= 9 ? shiftMonth(p.ym, -1) : null;
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`;
}

// ── answers → metrics ───────────────────────────────────────────────────────

export const METRICS = [
  { key: "revenue", label: "Revenue" },
  { key: "grossProfit", label: "Gross profit" },
  { key: "netProfit", label: "Net profit" },
  { key: "cash", label: "Net cash flow" },
  { key: "receivables", label: "Owed to us (AR)" },
  { key: "payables", label: "We owe (AP)" },
  { key: "headcount", label: "Headcount" },
] as const;
export type MetricKey = (typeof METRICS)[number]["key"];
export type Metric = { value: number | null; previous: number | null };
type Metrics = Record<MetricKey, Metric>;

/** The same definitions everywhere; a system that does not report one leaves it empty (never 0). */
export const DEFINITIONS: Record<MetricKey, string> = {
  revenue: "Sales for the month from the books (Hookka, Houzs, 2990s: the P&L); The Conts: reservation income on the Dashboard; Dream Crafter: sales invoices dated in the month.",
  grossProfit: "Revenue minus cost of sales, from the books.",
  netProfit: "Profit after all costs, from the books.",
  cash: "Net cash flow for the month (operating + investing + financing), where the system keeps a cash flow.",
  receivables: "What customers owe today (the AR ageing at the time of the report; no month-before figure).",
  payables: "What we owe suppliers today (the AP ageing at the time of the report; no month-before figure).",
  headcount: "People at the end of the month: Hookka active workers; HRIS staff across every company it holds (not added to Hookka's, the two may overlap).",
};

export type Extra = { label: string; value: string };
export type Normalised = { metrics: Metrics; extras: Extra[]; notes: string[]; rows?: { company: string; cells: Extra[] }[] };

const blank = (): Metrics => Object.fromEntries(METRICS.map((m) => [m.key, { value: null, previous: null }])) as Metrics;
const rmText = (v: number | null) => (v === null ? "—" : `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);

export function normalise(shape: Shape, answer: unknown): Normalised {
  const a = obj(answer);
  const m = blank();
  const extras: Extra[] = [];
  const notes: string[] = [];
  const set = (k: MetricKey, value: unknown, previous?: unknown) => {
    m[k] = { value: n(value), previous: n(previous) };
  };
  if (shape === "hookka") {
    const pl = obj(a.profitAndLoss);
    const pp = obj(a.previousPeriod);
    set("revenue", pl.revenueRm, pp.revenueRm);
    set("grossProfit", pl.grossProfitRm, pp.grossProfitRm);
    set("netProfit", pl.netProfitRm, pp.netProfitRm);
    if (a.cashFlow) set("cash", obj(a.cashFlow).netRm, obj(a.cashFlow).previousNetRm);
    if (a.receivablesNow) set("receivables", obj(a.receivablesNow).owedToUsRm);
    if (a.payablesNow) set("payables", obj(a.payablesNow).weOweRm);
    set("headcount", obj(a.headcount).now, obj(a.headcount).previous);
    if (n(pl.grossMarginPct) !== null) extras.push({ label: "Gross margin", value: `${n(pl.grossMarginPct)}%` });
    if (a.production) extras.push({ label: "Production revenue", value: rmText(n(obj(a.production).productionRevenueRm)) });
    if (a.balanceSheet) extras.push({ label: "Inventory at month end", value: rmText(n(obj(a.balanceSheet).inventoryRm)) });
    if (a.receivablesNow) extras.push({ label: "Owed to us over 60 days", value: rmText(n(obj(a.receivablesNow).over60DaysRm)) });
    if (Array.isArray(a.monthsWithoutFigures) && a.monthsWithoutFigures.length) notes.push(`No ledger figures yet for ${(a.monthsWithoutFigures as unknown[]).join(", ")}.`);
    if (a.estimated) notes.push(str(a.estimated));
  } else if (shape === "houzs") {
    const pl = a.profitAndLoss === null || a.profitAndLoss === undefined ? null : obj(a.profitAndLoss);
    if (pl) {
      const prev = obj(pl.previous);
      set("revenue", pl.salesRm, prev.salesRm);
      set("grossProfit", pl.grossProfitRm, prev.grossProfitRm);
      set("netProfit", pl.netProfitRm, prev.netProfitRm);
      if (n(pl.grossMarginPct) !== null) extras.push({ label: "Gross margin", value: `${n(pl.grossMarginPct)}%` });
    } else notes.push("The P&L is not readable with this login (it needs finance access there).");
    if (a.receivables) set("receivables", obj(a.receivables).totalRm);
    if (a.payables) set("payables", obj(a.payables).totalRm);
    if (a.salesOrders) {
      const so = obj(a.salesOrders);
      extras.push({ label: "Sales orders taken", value: `${rmText(n(so.salesRm))}${n(so.previousRm) !== null ? ` (month before ${rmText(n(so.previousRm))})` : ""}` });
    }
    if (a.afterSales) extras.push({ label: "Service cases past deadline", value: str(obj(a.afterSales).pastDeadline) });
  } else if (shape === "conts") {
    const h = obj(a.headline);
    const now = obj(h.thisPeriod);
    const before = obj(h.previous);
    set("revenue", now.reservationIncomeRm, before.reservationIncomeRm);
    if (n(now.occupancyPct) !== null) extras.push({ label: "Occupancy", value: `${n(now.occupancyPct)}%${n(before.occupancyPct) !== null ? ` (month before ${n(before.occupancyPct)}%)` : ""}` });
    if (n(now.activeUnits) !== null) extras.push({ label: "Active units", value: str(now.activeUnits) });
    if (a.ownerStatements) extras.push({ label: "Net payout to owners", value: rmText(n(obj(a.ownerStatements).netPayoutToOwnersRm)) });
    if (a.reservations) extras.push({ label: "Reservations / nights", value: `${str(obj(a.reservations).reservations)} / ${str(obj(a.reservations).nights)}` });
    notes.push("The Conts' company report has no P&L lines, so gross and net profit are not reported.");
  } else if (shape === "dream_crafter") {
    const s = obj(a.sales);
    const p = obj(a.purchases);
    if (a.sales) set("revenue", s.totalRm, obj(s.previous).totalRm);
    if (a.purchases) extras.push({ label: "Purchase invoices", value: `${rmText(n(p.totalRm))}${n(obj(p.previous).totalRm) !== null ? ` (month before ${rmText(n(obj(p.previous).totalRm))})` : ""}` });
    if (n(a.grossDifferenceRm) !== null) extras.push({ label: "Sales minus purchases (not gross profit)", value: rmText(n(a.grossDifferenceRm)) });
    if (a.sales) extras.push({ label: "Sales still unpaid (this month's invoices)", value: rmText(n(s.stillOpenRm)) });
  } else if (shape === "hris") {
    const g = obj(a.group);
    const people = obj(g.people);
    // Start of the month = end of the month before: end − joined + left.
    const end = n(people.headcountEnd);
    const start = end === null ? null : end - (n(people.joined) ?? 0) + (n(people.left) ?? 0);
    set("headcount", end, start);
    const pay = obj(g.payroll);
    if (n(pay.employerCostRM) !== null) extras.push({ label: "Payroll, employer cost", value: `${rmText(n(pay.employerCostRM))}${n(obj(pay.previous).employerCostRM) !== null ? ` (month before ${rmText(n(obj(pay.previous).employerCostRM))})` : ""}` });
    else if (typeof g.payroll === "string") notes.push(`Payroll: ${g.payroll}`);
    if (n(people.joined) !== null) extras.push({ label: "Joined / left", value: `${n(people.joined)} / ${n(people.left) ?? 0}` });
    if (n(people.turnoverPct) !== null) extras.push({ label: "Turnover", value: `${n(people.turnoverPct)}%` });
    if (n(obj(g.claims).approvedRM) !== null) extras.push({ label: "Claims approved", value: rmText(n(obj(g.claims).approvedRM)) });
    if (n(obj(g.overtime).approvedHours) !== null) extras.push({ label: "Overtime approved", value: `${n(obj(g.overtime).approvedHours)} h` });
    const rows = arr(a.companies).map((c) => {
      const pp = obj(c.people);
      const py = obj(c.payroll);
      return {
        company: str(c.company),
        cells: [
          { label: "Headcount", value: n(pp.headcountEnd) === null ? (typeof c.people === "string" ? "no access" : "—") : str(pp.headcountEnd) },
          { label: "Joined / left", value: n(pp.joined) === null ? "—" : `${n(pp.joined)} / ${n(pp.left) ?? 0}` },
          { label: "Payroll (employer cost)", value: n(py.employerCostRM) === null ? (typeof c.payroll === "string" ? "no access" : "—") : rmText(n(py.employerCostRM)) },
        ],
      };
    });
    return { metrics: m, extras, notes, rows };
  }
  return { metrics: m, extras, notes };
}

// ── the report ──────────────────────────────────────────────────────────────

export type Outcome =
  | { status: "ok"; answer: unknown }
  | { status: "not_connected" }
  | { status: "no_access"; message: string }
  | { status: "error"; message: string };

export type CompanySection = { company: string; system: string; status: Outcome["status"]; message: string; data: Normalised | null };

/** A tool reply → its JSON: structuredContent first, else the text (JSON, maybe after a note line). */
export function answerOf(r: { content?: { type: string; text?: string }[]; structuredContent?: Obj; isError?: boolean }): Outcome {
  const t = (r.content ?? []).map((c) => c.text ?? "").join("\n");
  if (r.isError) return /access|permission|not available to your role|forbidden|not allowed/i.test(t) ? { status: "no_access", message: t.slice(0, 240) || "No access." } : { status: "error", message: t.slice(0, 240) || "The system answered with an error." };
  if (r.structuredContent && r.structuredContent.truncated !== true) return { status: "ok", answer: r.structuredContent };
  try {
    return { status: "ok", answer: JSON.parse(t) };
  } catch {
    const i = t.indexOf("{");
    if (i >= 0) {
      try {
        return { status: "ok", answer: JSON.parse(t.slice(i)) };
      } catch {
        /* fall through */
      }
    }
  }
  return { status: "error", message: "The answer could not be read." };
}

export type GroupReport = {
  month: string;
  previousMonth: string;
  builtAt: string;
  totals: Record<MetricKey, Metric & { companies: number }>;
  companies: CompanySection[];
  systems: { key: string; name: string; status: "connected" | "not_connected" | "partial" | "error" }[];
};

/** outcomes: per system key, per company name (as in GROUP_SYSTEMS). A system missing = not connected. */
export function buildGroupReport(month: string, outcomes: Record<string, Record<string, Outcome>>, builtAt: string): GroupReport {
  const companies: CompanySection[] = [];
  const systems: GroupReport["systems"] = [];
  for (const sys of GROUP_SYSTEMS) {
    const got = outcomes[sys.key];
    const states: string[] = [];
    for (const call of sys.calls) {
      const o: Outcome = got?.[call.company] ?? { status: "not_connected" };
      states.push(o.status);
      companies.push({
        company: call.company,
        system: sys.name,
        status: o.status,
        message:
          o.status === "not_connected"
            ? `${sys.name} is not connected to the group report.`
            : o.status === "no_access"
              ? `No access with the connected login: ${o.message}`
              : o.status === "error"
                ? `${sys.name} did not answer: ${o.message}`
                : "",
        data: o.status === "ok" ? normalise(call.shape, o.answer) : null,
      });
    }
    systems.push({ key: sys.key, name: sys.name, status: !got ? "not_connected" : states.every((s) => s === "ok") ? "connected" : states.some((s) => s === "ok") ? "partial" : "error" });
  }
  // Group totals: money summed over the companies that report the figure; previous only when
  // every one of them also reports the month before (so the comparison is like for like).
  // Headcount is not added up across systems (HRIS and Hookka may count the same people).
  const totals = {} as GroupReport["totals"];
  for (const { key } of METRICS) {
    const have = companies.filter((c) => c.data && c.data.metrics[key].value !== null).map((c) => c.data!.metrics[key]);
    if (key === "headcount") {
      totals[key] = { value: null, previous: null, companies: have.length };
      continue;
    }
    const value = have.length ? round2(have.reduce((s, x) => s + (x.value ?? 0), 0)) : null;
    const previous = have.length && have.every((x) => x.previous !== null) ? round2(have.reduce((s, x) => s + (x.previous ?? 0), 0)) : null;
    totals[key] = { value, previous, companies: have.length };
  }
  return { month, previousMonth: shiftMonth(month, -1), builtAt, totals, companies, systems };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ── HTML ────────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const e = (v: unknown) => escapeHtml(str(v));

export function fmt(key: MetricKey, v: number | null): string {
  if (v === null) return "—";
  return key === "headcount" ? Math.round(v).toLocaleString("en-MY") : `RM ${v.toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** "vs RM 1,000 (+12.5%)" — or the reason there is no comparison. */
export function vsPrevious(key: MetricKey, m: Metric): string {
  if (m.value === null) return "";
  if (key === "receivables" || key === "payables") return "today";
  if (m.previous === null) return "no month-before figure";
  const diff = m.value - m.previous;
  const pct = m.previous !== 0 ? `${diff >= 0 ? "+" : ""}${(Math.round((diff / Math.abs(m.previous)) * 1000) / 10).toFixed(1)}%` : diff === 0 ? "no change" : "new";
  return `vs ${fmt(key, m.previous)} (${pct})`;
}

const FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const TH = "text-align:left;padding:6px 8px;border-bottom:1px solid #D0D7DE;font-size:12px;color:#57606A;font-weight:600;white-space:nowrap";
const TD = "padding:6px 8px;border-bottom:1px solid #EAEEF2;font-size:13px;vertical-align:top";

function cell(key: MetricKey, m: Metric): string {
  const v = vsPrevious(key, m);
  return `<td style="${TD}">${e(fmt(key, m.value))}${v ? `<br><span style="color:#57606A;font-size:11px">${e(v)}</span>` : ""}</td>`;
}

export function renderReportHtml(r: GroupReport, opts: { hubUrl: string }): string {
  const head = METRICS.map((m) => `<th style="${TH}">${e(m.label)}</th>`).join("");
  const summaryRows = r.companies
    .map((c) => {
      if (!c.data) return `<tr><td style="${TD}"><strong>${e(c.company)}</strong><br><span style="color:#57606A;font-size:11px">${e(c.system)}</span></td><td style="${TD};color:#9A6700" colspan="${METRICS.length}">${e(c.message)}</td></tr>`;
      return `<tr><td style="${TD}"><strong>${e(c.company)}</strong><br><span style="color:#57606A;font-size:11px">${e(c.system)}</span></td>${METRICS.map((m) => cell(m.key, c.data!.metrics[m.key])).join("")}</tr>`;
    })
    .join("");
  const totalRow = `<tr style="background:#F6F8FA"><td style="${TD}"><strong>Group total</strong><br><span style="color:#57606A;font-size:11px">companies reporting each figure</span></td>${METRICS.map((m) => {
    const t = r.totals[m.key];
    if (m.key === "headcount") return `<td style="${TD};color:#57606A;font-size:11px">not added up across systems</td>`;
    return `${cell(m.key, t).replace("</td>", `<br><span style="color:#57606A;font-size:11px">${t.companies} compan${t.companies === 1 ? "y" : "ies"}</span></td>`)}`;
  }).join("")}</tr>`;

  const sections = r.companies
    .map((c) => {
      const title = `<h2 style="font-size:16px;margin:24px 0 6px">${e(c.company)} <span style="color:#57606A;font-weight:400;font-size:13px">· ${e(c.system)}</span></h2>`;
      if (!c.data) return `${title}<p style="margin:0;color:#9A6700;font-size:14px">${e(c.message)}</p>`;
      const d = c.data;
      const lines = METRICS.filter((m) => d.metrics[m.key].value !== null).map((m) => `<tr><td style="${TD}">${e(m.label)}</td><td style="${TD}">${e(fmt(m.key, d.metrics[m.key].value))}</td><td style="${TD};color:#57606A">${e(vsPrevious(m.key, d.metrics[m.key]))}</td></tr>`);
      const extra = d.extras.map((x) => `<tr><td style="${TD}">${e(x.label)}</td><td style="${TD}" colspan="2">${e(x.value)}</td></tr>`);
      const table = lines.length || extra.length ? `<table role="presentation" style="border-collapse:collapse;width:100%;max-width:640px">${lines.join("")}${extra.join("")}</table>` : `<p style="margin:0;color:#57606A;font-size:13px">No figures came back for this month.</p>`;
      const rows = d.rows?.length
        ? `<div style="overflow-x:auto"><table role="presentation" style="border-collapse:collapse;margin-top:8px;min-width:420px"><tr><th style="${TH}">Company</th>${d.rows[0]!.cells.map((x) => `<th style="${TH}">${e(x.label)}</th>`).join("")}</tr>${d.rows.map((row) => `<tr><td style="${TD}">${e(row.company)}</td>${row.cells.map((x) => `<td style="${TD}">${e(x.value)}</td>`).join("")}</tr>`).join("")}</table></div>`
        : "";
      const notes = d.notes.length ? `<p style="margin:6px 0 0;color:#57606A;font-size:12px">${d.notes.map(e).join(" ")}</p>` : "";
      return `${title}${table}${rows}${notes}`;
    })
    .join("");

  const defs = METRICS.map((m) => `<li><strong>${e(m.label)}</strong>: ${e(DEFINITIONS[m.key])}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Group report ${e(r.month)}</title></head>
<body style="margin:0;background:#F4F5F7;font-family:${FONT};color:#1F2328">
<div style="max-width:960px;margin:0 auto;padding:20px 16px">
<h1 style="font-size:22px;margin:0 0 4px">Group report: ${e(monthLabel(r.month))}</h1>
<p style="margin:0 0 16px;color:#57606A;font-size:13px">Compared with ${e(monthLabel(r.previousMonth))}. Built ${e(r.builtAt.slice(0, 16).replace("T", " "))} UTC from each system's own company report, with the connected admin's own access there. Money in RM.</p>
<div style="background:#fff;border:1px solid #D0D7DE;border-radius:10px;padding:12px 14px">
<h2 style="font-size:16px;margin:0 0 8px">Group summary</h2>
<div style="overflow-x:auto"><table role="presentation" style="border-collapse:collapse;min-width:820px"><tr><th style="${TH}">Company</th>${head}</tr>${summaryRows}${totalRow}</table></div>
</div>
<div style="background:#fff;border:1px solid #D0D7DE;border-radius:10px;padding:0 14px 14px;margin-top:12px">${sections}</div>
<div style="margin-top:12px;color:#57606A;font-size:12px"><p style="margin:0 0 4px"><strong>Definitions</strong> (the same for every company):</p><ul style="margin:0;padding-left:18px;line-height:1.5">${defs}</ul>
<p style="margin:8px 0 0">— means the system does not report that figure, or not to this login. <a href="${e(opts.hubUrl)}/group-report" style="color:#0969DA">Open the group report in IT Hub</a>.</p></div>
</div></body></html>`;
}

/** Text version for the email. */
export function renderReportText(r: GroupReport, opts: { hubUrl: string }): string {
  const lines = [`Group report: ${monthLabel(r.month)} (vs ${monthLabel(r.previousMonth)})`, ""];
  for (const c of r.companies) {
    lines.push(`${c.company} (${c.system})`);
    if (!c.data) lines.push(`  ${c.message}`);
    else for (const m of METRICS) if (c.data.metrics[m.key].value !== null) lines.push(`  ${m.label}: ${fmt(m.key, c.data.metrics[m.key].value)} ${vsPrevious(m.key, c.data.metrics[m.key])}`.trimEnd());
    lines.push("");
  }
  lines.push(`Open it in IT Hub: ${opts.hubUrl}/group-report`);
  return lines.join("\n");
}
