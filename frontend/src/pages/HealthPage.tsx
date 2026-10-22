import { Pencil, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, json, type HealthCheck, type HealthReportRow, type HealthTarget } from "../api/client";
import { HealthReportView } from "../components/HealthReport";
import { SystemTag } from "../components/Bits";
import { EditDialog, Field, Select } from "../components/EditForm";
import { useHub } from "../components/Layout";
import { toBlocks } from "../lib/blocks";
import { fmtAgo, fmtDateTime } from "../lib/format";
import { usePoll } from "../lib/usePoll";

type Data = {
  targets: HealthTarget[];
  checks: HealthCheck[];
  systems: { code: string; name: string }[];
  reports: { latest: HealthReportRow[]; history: { systemCode: string; receivedAt: string; ok: number }[] };
};
type State = "up" | "slow" | "down" | "none";

// Slower than this counts as Slow: still answering, but staff would notice.
const SLOW_MS = 2000;
const STATE: Record<State, { label: string; pill: string; bar: string }> = {
  up: { label: "Up", pill: "bg-loz-green text-loz-green-ink", bar: "bg-loz-green-ink" },
  slow: { label: "Slow", pill: "bg-loz-orange text-loz-orange-ink", bar: "bg-loz-orange-ink" },
  down: { label: "Down", pill: "bg-loz-red text-loz-red-ink", bar: "bg-loz-red-ink" },
  none: { label: "No data yet", pill: "bg-loz-grey text-loz-grey-ink", bar: "bg-line" },
};
const stateOf = (c: HealthCheck | undefined): State => (!c ? "none" : !c.ok ? "down" : (c.ms ?? 0) > SLOW_MS ? "slow" : "up");

function minutes(fromIso: string) {
  const m = Math.max(1, Math.round((Date.now() - new Date(fromIso).getTime()) / 60000));
  return m < 90 ? `${m} min` : `${Math.round(m / 60)} h`;
}

function summarise(checks: HealthCheck[]) {
  // checks arrive newest first
  const latest = checks[0];
  const ok = checks.filter((c) => c.ok);
  const uptime = checks.length ? Math.round((ok.length / checks.length) * 1000) / 10 : null;
  const avgMs = ok.length ? Math.round(ok.reduce((a, c) => a + (c.ms ?? 0), 0) / ok.length) : null;
  let downSince: string | null = null;
  if (latest && !latest.ok) {
    downSince = latest.checkedAt;
    for (const c of checks) {
      if (c.ok) break;
      downSince = c.checkedAt;
    }
  }
  const version = checks.find((c) => c.version)?.version ?? null;
  const changed = version ? checks.find((c) => c.version && c.version !== version) : undefined;
  // The newest check before the version changed marks roughly when the new version arrived.
  const deployedAt = changed ? checks[checks.indexOf(changed) - 1]?.checkedAt ?? null : null;
  return { latest, uptime, avgMs, downSince, version, deployedAt };
}

type Draft = { name: string; systemCode: string; checkUrl: string; pageUrl: string; sort: string; active: string };
const EMPTY: Draft = { name: "", systemCode: "", checkUrl: "https://", pageUrl: "", sort: "0", active: "1" };

export default function HealthPage() {
  const { me } = useHub();
  const canEdit = !!me.perms?.includes("health_edit");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState<HealthTarget | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const dialog = useRef<HTMLDialogElement>(null);
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab") ?? "all";
  const showTab = (tab: string) => setParams(tab === "all" ? {} : { tab }, { replace: true });

  const load = useCallback(() => {
    api<Data>("/health")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  usePoll(load, 60_000);

  const checkNow = async () => {
    setChecking(true);
    try {
      await api("/health/check-now", { method: "POST" });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const open = (t: HealthTarget | "new") => {
    setEditing(t);
    setDraft(t === "new" ? EMPTY : { ...t, systemCode: t.systemCode ?? "", sort: String(t.sort), active: String(t.active) });
    dialog.current?.showModal();
  };
  const save = async () => {
    const body = { ...draft, sort: Number(draft.sort) || 0, active: draft.active === "1" };
    if (editing === "new") await api("/health/targets", json("POST", body));
    else if (editing) await api(`/health/targets/${editing.id}`, json("PATCH", body));
    load();
  };
  const remove = async () => {
    if (!editing || editing === "new") return;
    await api(`/health/targets/${editing.id}`, { method: "DELETE" });
    load();
  };
  const set = (k: keyof Draft) => (v: string) => setDraft({ ...draft, [k]: v });

  const active = data?.targets.filter((t) => t.active) ?? [];
  const states = active.map((t) => stateOf(data?.checks.find((c) => c.targetId === t.id)));
  const down = states.filter((s) => s === "down").length;
  const slow = states.filter((s) => s === "slow").length;
  const waiting = states.filter((s) => s === "none").length;
  // Systems with their own health page get a tab that shows that page inside the hub.
  // One tab per hub system that is checked or has sent a health report, showing that report.
  const reportOf = (code: string) => data?.reports.latest.find((r) => r.systemCode === code) ?? null;
  const systemTabs = (data?.systems ?? []).filter((s) => data?.targets.some((t) => t.systemCode === s.code) || reportOf(s.code));
  const current = systemTabs.find((s) => s.code === tabParam) ?? null;
  const tab = current ? tabParam : "all";
  const tabState = (code: string): State => {
    const ids = data?.targets.filter((t) => t.systemCode === code && t.active).map((t) => t.id) ?? [];
    const states = ids.map((id) => stateOf(data?.checks.find((c) => c.targetId === id)));
    const report = reportOf(code);
    if (states.includes("down") || (report && !report.ok)) return "down";
    if (states.includes("slow")) return "slow";
    return states.includes("up") || report ? "up" : "none";
  };

  return (
    <div className="h-full overflow-auto px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Houzs Hub · Admin</div>
          <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">System health</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-subtle">
            The hub checks each system every 5 minutes: whether it answers, how fast, and which version it runs. Each system also sends the
            hub its own health report with its hub key, shown in its tab. Refreshes every minute.
          </p>
        </div>
        {canEdit && tabParam === "all" && (
          <div className="flex gap-2">
            <button className="btn-default" onClick={checkNow} disabled={checking}>
              <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} /> {checking ? "Checking..." : "Check now"}
            </button>
            <button className="btn-primary" onClick={() => open("new")}>
              <Plus className="h-4 w-4" /> Add system
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
          {error}
        </div>
      )}
      {!data && !error && <div className="py-16 text-center text-sm text-ink-subtle">Loading...</div>}

      {data && (
        <div role="tablist" className="mt-4 flex gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap border-b border-line">
          {[{ key: "all", label: "All systems", state: null as State | null }, ...systemTabs.map((x) => ({ key: x.code, label: x.name, state: tabState(x.code) }))].map((x) => (
            <button
              key={x.key}
              role="tab"
              aria-selected={tab === x.key}
              onClick={() => showTab(x.key)}
              className={`tap -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold ${
                tab === x.key ? "border-primary text-ink" : "border-transparent text-ink-subtle hover:text-ink"
              }`}
            >
              {x.state && <span className={`h-2 w-2 rounded-full ${STATE[x.state].bar}`} aria-hidden />}
              {x.label}
            </button>
          ))}
        </div>
      )}

      {data && current && (
        <HealthReportView
          name={current.name}
          report={reportOf(current.code)}
          history={data.reports.history.filter((h) => h.systemCode === current.code)}
          pageUrl={data.targets.find((t) => t.systemCode === current.code && t.pageUrl)?.pageUrl ?? ""}
        />
      )}

      {data && tab === "all" && active.length > 0 && (
        <div
          role="status"
          className={`mt-4 rounded-[10px] px-4 py-3 text-[14px] font-semibold ${
            down ? "bg-loz-red text-loz-red-ink" : slow ? "bg-loz-orange text-loz-orange-ink" : waiting === active.length ? "bg-loz-grey text-loz-grey-ink" : "bg-loz-green text-loz-green-ink"
          }`}
        >
          {down
            ? `${down} of ${active.length} systems down`
            : slow
              ? `All ${active.length} systems answering, ${slow} slow`
              : waiting === active.length
                ? "Waiting for the first check"
                : `All ${active.length - waiting} systems up`}
        </div>
      )}

      {tab === "all" && (
      <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {data?.targets.map((t) => {
          const checks = data.checks.filter((c) => c.targetId === t.id);
          const s = summarise(checks);
          const state = stateOf(s.latest);
          const blocks = toBlocks(checks, (c) => c.checkedAt, (c) => ({ up: 0, slow: 1, down: 2, none: 0 })[stateOf(c)]);
          return (
            <section key={t.id} className={`card p-4 ${t.active ? "" : "opacity-60"}`} aria-label={t.name}>
              <div className="flex items-start gap-2.5">
                {t.systemCode && <SystemTag code={t.systemCode} />}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">{t.name}</div>
                  <div className="truncate text-xs text-ink-subtlest" title={t.checkUrl}>
                    {t.checkUrl.replace(/^https:\/\//, "")}
                  </div>
                </div>
                {t.active ? <span className={`pill ${STATE[state].pill}`}>{STATE[state].label}</span> : <span className="pill bg-loz-grey text-loz-grey-ink">Paused</span>}
                {canEdit && (
                  <button className="btn-subtle h-8 w-8 px-0" title="Edit" aria-label={`Edit ${t.name}`} onClick={() => open(t)}>
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>

              {state === "down" && s.latest && (
                <div className="mt-3 rounded bg-loz-red px-3 py-2 text-[12.5px] text-loz-red-ink">
                  {s.latest.error ?? "Not answering"}
                  {s.downSince && ` · down for ${minutes(s.downSince)}`}
                </div>
              )}

              <dl className="mt-3 grid grid-cols-3 gap-2 text-[12.5px]">
                <Stat label="Speed" value={s.latest?.ms != null ? `${s.latest.ms} ms` : "-"} note={s.avgMs != null ? `avg ${s.avgMs} ms` : ""} />
                <Stat label="Up, last 24h" value={s.uptime != null ? `${s.uptime}%` : "-"} note={`${checks.length} checks`} />
                <Stat label="Version" value={s.version ?? "-"} note={s.deployedAt ? `new ${fmtAgo(s.deployedAt)}` : ""} />
              </dl>

              <div className="mt-3" aria-label="Last 24 hours">
                <div className="flex h-6 items-end gap-px overflow-hidden" title="Each bar is 15 minutes, oldest on the left; it shows the worst check in it">
                  {blocks.map((b) => {
                    const c = b.worst;
                    const st = stateOf(c ?? undefined);
                    return (
                      <div
                        key={b.from}
                        className={`min-w-0 flex-1 rounded-[1px] ${STATE[st].bar}`}
                        style={{ height: !c ? "30%" : c.ok ? "100%" : "45%" }}
                        title={`${fmtDateTime(new Date(b.from).toISOString())}: ${!c ? "no check" : !c.ok ? c.error ?? "down" : st === "slow" ? `slow, ${c.ms} ms` : `up (${b.count} checks)`}`}
                      />
                    );
                  })}
                </div>
                <div className="mt-1 flex justify-between text-[10.5px] text-ink-subtlest">
                  <span>24h ago</span>
                  <span>{s.latest ? `checked ${fmtAgo(s.latest.checkedAt)}` : "not checked yet"}</span>
                </div>
              </div>

              {t.systemCode && (
                <button className="btn-default mt-3 h-8 w-full px-3" onClick={() => showTab(t.systemCode!)}>
                  Show its full health
                </button>
              )}
            </section>
          );
        })}
      </div>
      )}

      <EditDialog
        dialogRef={dialog}
        title={editing === "new" ? "Add system" : "Edit system"}
        isNew={editing === "new"}
        stamp={editing && editing !== "new" ? editing : null}
        onSave={save}
        onRemove={remove}
        onClose={() => setEditing(null)}
      >
        {editing && data && (
          <>
            <Field label="Name" value={draft.name} onChange={set("name")} required />
            <Select label="Hub system" value={draft.systemCode} onChange={set("systemCode")} options={[["", "None"], ...data.systems.map((s) => [s.code, s.name] as [string, string])]} />
            <Field
              label="Check address"
              value={draft.checkUrl}
              onChange={set("checkUrl")}
              required
              area
              hint="A public https:// address the hub opens every 5 minutes: the system's health address, or its sign-in page if it has none"
            />
            <Field label="Its health page" value={draft.pageUrl} onChange={set("pageUrl")} area hint="Optional: the system's own health page, for the button on the card" />
            <Field label="Order" value={draft.sort} onChange={set("sort")} type="number" />
            <Select label="Checking" value={draft.active} onChange={set("active")} options={[["1", "On"], ["0", "Paused"]]} />
          </>
        )}
      </EditDialog>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-brand text-ink-subtlest">{label}</dt>
      <dd className="truncate font-semibold tabular-nums text-ink" title={value}>
        {value}
      </dd>
      {note && <dd className="text-[11px] text-ink-subtle">{note}</dd>}
    </div>
  );
}
