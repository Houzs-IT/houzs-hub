import { ExternalLink } from "lucide-react";
import type { HealthReport, HealthReportRow, HealthStatus } from "../api/client";
import { toBlocks } from "../lib/blocks";
import { fmtAgo, fmtDateTime } from "../lib/format";

// A system's own health report, as it sent it to the hub with its hub key: the same
// figures its own System health page shows, drawn the same way for every system.

const STATUS: Record<HealthStatus, { pill: string; label: string; edge: string }> = {
  ok: { pill: "bg-loz-green text-loz-green-ink", label: "OK", edge: "border-l-loz-green-ink" },
  warning: { pill: "bg-loz-orange text-loz-orange-ink", label: "Warning", edge: "border-l-loz-orange-ink" },
  critical: { pill: "bg-loz-red text-loz-red-ink", label: "Problem", edge: "border-l-loz-red-ink" },
  off: { pill: "bg-loz-grey text-loz-grey-ink", label: "Off", edge: "border-l-line-strong" },
};
// A system sends every 5 minutes; three missed reports in a row is worth saying.
const STALE_MS = 15 * 60_000;

// Friendlier names for the counts the systems already send; anything else is spelled out from its key.
const COUNT_LABELS: Record<string, string> = {
  users_active: "Active users",
  users_invited: "Invited, not signed in yet",
  users_disabled: "Switched off",
  users_locked: "Locked out now",
  audit_24h: "Changes, last 24h",
  audit_7d: "Changes, last 7 days",
  sensitive_24h: "Sensitive changes, 24h",
  last_event_at: "Last change",
};
const labelOf = (k: string) => COUNT_LABELS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const valueOf = (v: number | string | null) =>
  v == null ? "-" : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? fmtAgo(v) : typeof v === "number" ? v.toLocaleString("en-MY") : v;

export function HealthReportView(props: {
  name: string;
  report: HealthReportRow | null;
  history: { receivedAt: string; ok: number }[];
  pageUrl: string;
}) {
  const { name, report: row, history, pageUrl } = props;
  const openOwn = pageUrl && (
    <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="btn-default h-8 px-3">
      Open {name}'s own page <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );

  if (!row) {
    return (
      <div className="card mt-4 p-6 text-center">
        <p className="text-[14px] font-semibold text-ink">{name} has not sent a health report yet.</p>
        <p className="mx-auto mt-1 max-w-xl text-[13px] text-ink-subtle">
          It needs a small change on its side: every 5 minutes it sends its health report to the hub with the hub key it already uses for
          IT support. Until then, the quick check on All systems still shows whether it is up.
        </p>
        {openOwn && <div className="mt-4 flex justify-center">{openOwn}</div>}
      </div>
    );
  }

  const r: HealthReport = row.report;
  const stale = Date.now() - Date.parse(row.receivedAt) > STALE_MS;
  const n = (k: string) => (typeof r.counts[k] === "number" ? (r.counts[k] as number) : null);
  // Users and the change history get their own cards, as on the systems' own pages
  // (Hookka's /admin/health and The Conts' System health); other counts stay in the list.
  const users = n("users_active");
  const history24 = n("audit_24h");
  const shown = new Set(users != null ? ["users_active", "users_invited", "users_disabled"] : []);
  if (history24 != null) ["audit_24h", "audit_7d", "sensitive_24h"].forEach((k) => shown.add(k));
  const counts = Object.entries(r.counts).filter(([k]) => !shown.has(k));
  const headline = [
    r.db?.ok && r.db.latency_ms != null ? `DB ${r.db.latency_ms} ms` : null,
    r.storage?.bound && r.storage.ok && r.storage.latency_ms != null ? `Storage ${r.storage.latency_ms} ms` : null,
    users != null ? `${users} active users` : null,
  ].filter(Boolean);
  const blocks = toBlocks(history, (h) => h.receivedAt, (h) => (h.ok ? 0 : 1));
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-ink-subtle" title={fmtDateTime(row.receivedAt)}>
          Report received {fmtAgo(row.receivedAt)}
          {r.published_at && ` · this version published ${fmtDateTime(r.published_at)}`}
        </span>
        <span className="ml-auto">{openOwn}</span>
      </div>
      <div
        role="status"
        className={`flex items-start gap-2.5 rounded-[10px] border px-4 py-3 ${
          r.ok ? "border-loz-green-ink/40 bg-loz-green text-loz-green-ink" : "border-loz-red-ink/40 bg-loz-red text-loz-red-ink"
        }`}
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.ok ? "bg-loz-green-ink" : "bg-loz-red-ink"}`} aria-hidden />
        <div>
          <div className="text-[14px] font-semibold">{r.ok ? "All systems normal" : "Something needs attention"}</div>
          {headline.length > 0 && <div className="text-[12.5px] opacity-90">{headline.join(" · ")}</div>}
        </div>
      </div>
      {stale && (
        <div role="alert" className="rounded bg-loz-orange px-3 py-2 text-[13px] text-loz-orange-ink">
          No new report for {fmtAgo(row.receivedAt).replace(" ago", "")}. {name} may have stopped sending; what follows is its last report.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {r.db && (
          <Tile
            label="DB latency"
            value={r.db.ok ? `${r.db.latency_ms ?? "-"} ms` : "Down"}
            status={r.db.ok ? ((r.db.latency_ms ?? 0) > 1500 ? "warning" : "ok") : "critical"}
            summary={r.db.ok ? "answered a live query" : r.db.error ?? "did not answer"}
          />
        )}
        {r.storage && (
          <Tile
            label="File storage"
            value={!r.storage.bound ? "-" : r.storage.ok ? `${r.storage.latency_ms ?? "-"} ms` : "Down"}
            status={!r.storage.bound ? "off" : r.storage.ok ? "ok" : "critical"}
            summary={!r.storage.bound ? "not connected" : r.storage.ok ? "reachable" : "did not answer"}
          />
        )}
        {users != null && (
          <Tile
            label="Active users"
            value={String(users)}
            status="ok"
            summary={[n("users_invited") != null ? `${n("users_invited")} invited` : null, n("users_disabled") != null ? `${n("users_disabled")} disabled` : null].filter(Boolean).join(" · ") || "signed in at least once"}
          />
        )}
        {history24 != null && (
          <Tile
            label="History 24h"
            value={String(history24)}
            status="ok"
            summary={[n("audit_7d") != null ? `${n("audit_7d")} in 7d` : null, n("sensitive_24h") != null ? `${n("sensitive_24h")} sensitive today` : null].filter(Boolean).join(" · ") || "changes recorded"}
          />
        )}
        {r.checks.map((c) => (
          <Tile key={c.key || c.label} label={c.label} value={c.value} status={c.status} summary={c.summary} detail={c.detail} />
        ))}
      </div>

      {counts.length > 0 && (
        <section className="card p-4" aria-label="Counts">
          <h2 className="section-title">Other figures</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {counts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] text-ink-subtle">{labelOf(k)}</dt>
                <dd className="text-[16px] font-bold tabular-nums text-ink" title={typeof v === "string" ? v : undefined}>
                  {valueOf(v)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="card overflow-hidden" aria-label="Recent problems">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="section-title">Problems in the last 7 days</h2>
          <span className="text-xs text-ink-subtle">{r.problems.length} in the report</span>
        </div>
        {r.problems.length === 0 ? (
          <p className="px-4 pb-4 pt-2 text-[13px] text-ink-subtle">None recorded.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line-subtle">
            {r.problems.map((p, i) => (
              <li key={`${p.at}${i}`} className="px-4 py-2.5 text-[13px]">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-ink">{p.what}</span>
                  {p.where && <span className="text-ink-subtle">· {p.where}</span>}
                  <span className="ml-auto text-xs text-ink-subtlest" title={fmtDateTime(p.at)}>
                    {fmtAgo(p.at)}
                  </span>
                </div>
                {p.error && <div className="mt-0.5 break-words text-xs text-loz-red-ink">{p.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {history.length > 1 && (
        <section className="card p-4" aria-label="Reports in the last 24 hours">
          <h2 className="section-title">Reports, last 24 hours</h2>
          <div className="mt-2 flex h-5 items-end gap-px overflow-hidden" title="Each bar is 15 minutes, oldest on the left">
            {blocks.map((b) => (
              <div
                key={b.from}
                className={`min-w-0 flex-1 rounded-[1px] ${!b.worst ? "bg-line" : b.worst.ok ? "bg-loz-green-ink" : "bg-loz-red-ink"}`}
                style={{ height: b.worst ? "100%" : "30%" }}
                title={`${fmtDateTime(new Date(b.from).toISOString())}: ${!b.worst ? "no report" : b.worst.ok ? "all OK" : "needs attention"}`}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, status, summary, detail }: { label: string; value: string; status: HealthStatus; summary: string; detail?: string }) {
  return (
    <div className={`card border-l-4 p-4 ${STATUS[status].edge}`}>
      <div className="flex items-start gap-2">
        <span className="section-title flex-1">{label}</span>
        <span className={`pill ${STATUS[status].pill}`}>{STATUS[status].label}</span>
      </div>
      <div className="mt-2 truncate text-[22px] font-extrabold tabular-nums text-ink" title={value}>
        {value}
      </div>
      <div className="text-xs text-ink-subtle">{summary}</div>
      {detail && <div className="mt-2 border-t border-line-subtle pt-2 text-[12px] text-ink-subtle">{detail}</div>}
    </div>
  );
}
