// System billing as an Excel file for one month, to send to someone without hub access.
// Built in the browser from the same data and the same totals the Overview shows:
// Summary, By vendor, Charges, AI usage, Invoices and Statement lines.
import type { BillingData as Data, ChargeRow } from "../api/client";
import { money } from "../lib/format";
import { buildXlsx, type Cell, type Sheet } from "../lib/xlsx";
import { BILLED, moduleLabel, NONE, sharesOf, STATUS } from "./BillingCharge";
import { allSystemsOf, fixedPerMonth, live, type T, type Unmatched } from "./BillingSystems";
import { monthName, monthOf } from "./BillingStatements";

export type ExportInput = {
  data: Data;
  month: string;
  before: string;
  paid: (c: ChargeRow, m: string) => number;
  totalsFor: (code: string) => T;
  unmatched: Unmatched;
};

const change = (now: number, before: number) => (now && before ? now / before - 1 : null);
const head = (labels: string[]): Cell[] => labels.map((v) => ({ v, s: "head" }));

function summary({ data, month, before, totalsFor, unmatched }: ExportInput): Sheet {
  const { rows, all, services, noSystem, notChecked, toConfirm } = allSystemsOf(data, month, totalsFor, unmatched);
  const m = monthName(month);
  return {
    name: "Summary",
    widths: [30, 12, 20, 20, 10, 20, 20, 22, 12],
    rows: [
      [{ v: `System billing — ${m}`, s: "title" }],
      [{ v: `Exported ${new Date().toLocaleString("en-MY")} from the Houzs IT Hub. Amounts paid are from the card statements; fixed plans from each charge's latest bill.`, s: "note" }],
      [],
      [{ v: `Paid in ${m}`, s: "bold" }, { v: all.paid, s: "rm" }, "on the company cards"],
      [{ v: "Fixed plans a month", s: "bold" }, { v: all.usd, s: "usd" }, all.myr ? { v: all.myr, s: "rm" } : null, "from latest bills, yearly ones ÷ 12"],
      [{ v: "Per credit / per use", s: "bold" }, { v: all.use, s: "rm" }, `paid in ${m}`],
      [{ v: "Not checked", s: "bold" }, notChecked, `statement lines in ${m} with no invoice${noSystem ? ` · ${noSystem} charge(s) with no system` : ""}`],
      [],
      [{ v: "By system", s: "bold" }],
      head(["System", "Services", `Paid ${m} (RM)`, `${monthName(before)} (RM)`, "Change", "Fixed a month (USD)", "Fixed a month (RM)", "Per credit / use (RM)", "To confirm"]),
      ...rows.map(({ name, t }): Cell[] => [
        name,
        t.services,
        { v: t.paid, s: "rm" },
        { v: t.before, s: "rm" },
        { v: change(t.paid, t.before), s: "pct" },
        { v: t.usd, s: "usd" },
        { v: t.myr, s: "rm" },
        { v: t.use, s: "rm" },
        t.open || null,
      ]),
      ["Statement lines not matched", unmatched.lines || null, { v: unmatched.now, s: "rm" }, { v: unmatched.before, s: "rm" }],
      [
        { v: "Total", s: "bold" },
        { v: services, s: "bold" },
        { v: all.paid, s: "rmBold" },
        { v: all.before, s: "rmBold" },
        { v: change(all.paid, all.before), s: "pctBold" },
        { v: all.usd, s: "usdBold" },
        { v: all.myr, s: "rmBold" },
        { v: all.use, s: "rmBold" },
        { v: toConfirm, s: "bold" },
      ],
    ],
  };
}

// One row per vendor, biggest first: a short table to read at a glance, the charges behind
// it are on the Charges sheet. Same rules as the Summary, so the totals agree; statement
// lines with no charge have no vendor and get their own row.
function vendors({ data, month, before, paid, unmatched }: ExportInput): Sheet {
  const short = (m: string) => monthName(m).split(" ")[0]!;
  const groups = new Map<string, ChargeRow[]>();
  for (const c of data.charges) {
    const vendor = c.vendor.trim() || "No vendor";
    groups.set(vendor, [...(groups.get(vendor) ?? []), c]);
  }
  const sum = (list: ChargeRow[], f: (c: ChargeRow) => number) => list.reduce((a, c) => a + f(c), 0);
  const fixed = (usd: number, myr: number, bold = false): Cell => {
    if (usd && myr) return { v: `${money(usd)} + ${money(myr, "MYR")}`, s: bold ? "rightBold" : "right" };
    if (usd) return { v: usd, s: bold ? "usdBold" : "usd" };
    if (myr) return { v: myr, s: bold ? "rmBold" : "rm" };
    return { v: "-", s: bold ? "rightBold" : "right" };
  };
  const list = [...groups]
    .map(([vendor, cs]) => ({
      vendor,
      cs,
      now: sum(cs, (c) => paid(c, month)),
      was: sum(cs, (c) => paid(c, before)),
      usd: sum(cs, (c) => fixedPerMonth(c).usd),
      myr: sum(cs, (c) => fixedPerMonth(c).myr),
    }))
    // Only cancelled charges and nothing paid in either month: nothing to report.
    .filter((v) => v.cs.some(live) || v.now || v.was)
    .sort((x, y) => y.now - x.now || x.vendor.localeCompare(y.vendor));
  const total = list.reduce((a, v) => a + v.now, unmatched.now);
  const totalBefore = list.reduce((a, v) => a + v.was, unmatched.before);
  const share = (n: number): Cell => (total && n ? { v: n / total, s: "pct" } : { v: "-", s: "right" });

  const rows: Cell[][] = [
    [{ v: `By vendor — ${monthName(month)}`, s: "title" }],
    [],
    head(["Vendor", `Paid ${short(month)}`, "Share", short(before), "Fixed a month"]),
    ...list.map((v): Cell[] => [v.vendor, { v: v.now, s: "rm" }, share(v.now), { v: v.was, s: "rm" }, fixed(v.usd, v.myr)]),
  ];
  if (unmatched.now || unmatched.before) rows.push(["Statement lines not matched", { v: unmatched.now, s: "rm" }, share(unmatched.now), { v: unmatched.before, s: "rm" }, { v: "-", s: "right" }]);
  rows.push([
    { v: `Total, all ${list.length} vendors`, s: "bold" },
    { v: total, s: "rmBold" },
    null,
    { v: totalBefore, s: "rmBold" },
    fixed(sum(list.flatMap((v) => v.cs), (c) => fixedPerMonth(c).usd), sum(list.flatMap((v) => v.cs), (c) => fixedPerMonth(c).myr), true),
  ]);
  return { name: "By vendor", widths: [34, 16, 9, 16, 24], rows };
}

function charges({ data, month, before, paid }: ExportInput): Sheet {
  const systemName = (code: string) => (code === NONE ? "No system yet" : (data.systems.find((s) => s.code === code)?.name ?? code));
  const rows = [...data.charges].sort((a, b) => a.registerId.localeCompare(b.registerId) || a.vendor.localeCompare(b.vendor));
  return {
    name: "Charges",
    widths: [9, 14, 40, 24, 30, 14, 36, 28, 20, 12, 12, 9, 12, 18, 18],
    rows: [
      head(["Sheet ID", "Vendor", "What it is for", "System", "Shared", "Module", "Project / API ID", "Key name", "Billing", "Card", "Latest bill", "Currency", "Status", `Paid ${monthName(month)} (RM)`, `Paid ${monthName(before)} (RM)`]),
      ...rows.map((c): Cell[] => {
        const shares = sharesOf(c, data, month);
        const system = c.splitByUsage ? "Shared, split by usage" : shares.length > 1 ? "Shared, split by %" : systemName(shares[0]?.code ?? NONE);
        const shared = shares.length > 1 ? shares.map((s) => `${systemName(s.code)} ${Math.round(s.part * 1000) / 10}%`).join(" · ") : "";
        return [
          c.registerId,
          c.vendor,
          c.usedFor,
          system,
          shared,
          c.module || "Whole system",
          c.projectRef,
          c.keyName,
          BILLED[c.billed],
          c.card,
          c.amount === null ? null : { v: c.amount, s: "num" },
          c.amount === null ? "" : c.currency,
          STATUS[c.status].label,
          { v: paid(c, month) || null, s: "rm" },
          { v: paid(c, before) || null, s: "rm" },
        ];
      }),
    ],
  };
}

function aiUsage({ data, month }: ExportInput): Sheet {
  const systemName = (code: string) => data.systems.find((s) => s.code === code)?.name ?? (code || "Not set");
  const ws = data.workspaces.filter((w) => w.vendor === "Anthropic");
  const usdOf = (id: string) => data.usage.filter((u) => u.vendor === "Anthropic" && u.month === month && u.workspaceId === id).reduce((a, u) => a + u.usd, 0);
  const total = ws.reduce((a, w) => a + usdOf(w.workspaceId), 0);
  const rows: Cell[][] = [
    [{ v: `Anthropic cost, ${monthName(month)}`, s: "title" }],
    [{ v: "Each workspace's total is Anthropic's real cost. Modules split it by the system's own log of its AI calls.", s: "note" }],
    [],
    head(["Workspace / module", "System", "Calls", "Cost (USD)", "Share"]),
  ];
  for (const w of ws) {
    const cost = usdOf(w.workspaceId);
    if (!cost) continue;
    rows.push([{ v: w.name || "Default workspace", s: "bold" }, systemName(w.systemCode), null, { v: cost, s: "usdBold" }, { v: total ? cost / total : null, s: "pctBold" }]);
    const est = data.moduleUsage.filter((m) => m.vendor === "Anthropic" && m.sourceSystem === w.systemCode && m.month === month);
    const estTotal = est.reduce((a, m) => a + m.usd, 0);
    if (!w.systemCode || estTotal <= 0) continue;
    for (const m of [...est].sort((a, b) => b.usd - a.usd)) {
      rows.push([`    ${moduleLabel(m.module)}`, systemName(m.systemCode), m.calls, { v: (cost * m.usd) / estTotal, s: "usd" }, { v: m.usd / estTotal, s: "pct" }]);
    }
  }
  rows.push([{ v: "Total", s: "bold" }, null, null, { v: total, s: "usdBold" }, { v: total ? 1 : null, s: "pctBold" }]);
  return { name: "AI usage", widths: [36, 16, 8, 14, 9], rows };
}

function invoices({ data, month }: ExportInput): Sheet {
  const list = data.invoices.filter((i) => monthOf(i.invoiceDate) === month).sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
  const lineById = new Map(data.lines.map((l) => [l.id, l]));
  const regOf = (id: number | null) => data.charges.find((c) => c.id === id)?.registerId ?? "";
  const ids = new Set(list.map((i) => i.id));
  const projects = data.invoiceLines.filter((l) => ids.has(l.invoiceId) && l.projectRef && l.kind === "charge");
  const rows: Cell[][] = [
    head(["Vendor", "Invoice no.", "Invoice date", "Charge", "Amount", "Currency", "Card line (RM)", "Card line date", "Matched"]),
    ...list.map((i): Cell[] => {
      const line = i.statementLineId ? lineById.get(i.statementLineId) : undefined;
      return [i.vendor, i.invoiceNo, i.invoiceDate, regOf(i.chargeId), { v: i.total, s: "num" }, i.currency, line ? { v: line.amountMyr, s: "rm" } : null, line?.txnDate ?? "", line ? "Yes" : "Not found yet"];
    }),
  ];
  if (projects.length) {
    const invNo = new Map(list.map((i) => [i.id, i]));
    rows.push([], [{ v: "Project lines on these invoices", s: "bold" }], head(["Invoice no.", "Project ID", "Project name", "In use", "Amount", "Currency"]));
    // An invoice lists a project once per item (compute, storage...); one row per project.
    const sums = new Map<string, { invoiceId: number; ref: string; amount: number }>();
    for (const l of projects) {
      const k = `${l.invoiceId}|${l.projectRef}`;
      const s = sums.get(k) ?? { invoiceId: l.invoiceId, ref: l.projectRef, amount: 0 };
      s.amount += l.amount;
      sums.set(k, s);
    }
    for (const s of sums.values()) {
      const r = data.projectRefs.find((x) => x.ref === s.ref);
      const inv = invNo.get(s.invoiceId)!;
      rows.push([inv.invoiceNo, s.ref, r?.name || "Not named", r && !r.inUse ? "No" : "Yes", { v: s.amount, s: "num" }, inv.currency]);
    }
  }
  if (!list.length) rows.push([{ v: `No invoices dated ${monthName(month)}.`, s: "note" }]);
  return { name: "Invoices", widths: [14, 22, 26, 10, 12, 10, 16, 14, 14], rows };
}

function statementLines({ data, month }: ExportInput): Sheet {
  const list = data.lines.filter((l) => monthOf(l.txnDate) === month).sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.id - b.id);
  const byRegister = new Map(data.charges.filter((c) => c.registerId).map((c) => [c.registerId, c]));
  const invoiceOf = new Map(data.invoices.filter((i) => i.statementLineId).map((i) => [i.statementLineId!, i.invoiceNo]));
  return {
    name: "Statement lines",
    widths: [12, 8, 40, 14, 10, 16, 18, 16, 30],
    rows: [
      head(["Date", "Card", "Description", "Amount (RM)", "Charge", "Vendor", "Invoice", "Checked by hand", "Notes"]),
      ...list.map((l): Cell[] => {
        const c = byRegister.get(l.registerId);
        return [l.txnDate, l.card, l.description, { v: l.amountMyr, s: "rm" }, c ? l.registerId : "(not matched)", c?.vendor ?? "", invoiceOf.get(l.id) ?? "", l.checkedByHand ? "Yes" : "No", l.notes];
      }),
      ...(list.length ? [] : [[{ v: `No card statement lines in ${monthName(month)}.`, s: "note" } as Cell]]),
    ],
  };
}

export function billingWorkbook(input: ExportInput): Sheet[] {
  return [summary(input), vendors(input), charges(input), aiUsage(input), invoices(input), statementLines(input)];
}

export function downloadBillingExport(input: ExportInput) {
  const blob = buildXlsx(billingWorkbook(input));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `System billing - ${monthName(input.month)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
