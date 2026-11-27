// ---------------------------------------------------------------------------
// /group-report — the group monthly report (AI Connector round 4d D3). Admins with Manage roles.
// Connect each system once (its own sign-in and "Allow?" screen), build a month now, read
// past reports. Every rule is the server's (backend routes/groupReport.ts). Works at phone width.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { FileBarChart, Link2, RefreshCw, Unlink } from "lucide-react";
import { useSearchParams } from "react-router-dom";

type SystemState = { key: string; name: string; mcpUrl: string; companies: string[]; connected: boolean; connectedBy: string | null; connectedAt: string | null; lastUsedAt: string | null; lastError: string | null };
type Report = { id: number; month: string; kind: string; builtAt: string; builtBy: string | null; systems: { key: string; name: string; status: string }[]; emailedTo: string | null; emailedAt: string | null; note: string | null };
type State = { configured: boolean; mailReady: boolean; schedule: string; systems: SystemState[]; reports: Report[] };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/group-report${path}`, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) {
    location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    return new Promise<T>(() => {});
  }
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const when = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-MY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const monthName = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
};
const lastMonth = () => {
  const d = new Date(Date.now() + 8 * 3600_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
const thisMonth = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 7);

const ERRORS: Record<string, string> = {
  expired: "The connection took too long or was already used. Click Connect again.",
  denied: "The connection was cancelled on the other system.",
  token: "The other system did not hand over the sign-in. Click Connect again.",
  no_code: "The other system sent no sign-in code. Click Connect again.",
  missing_state: "The return link was incomplete. Click Connect again.",
  not_configured: "The group report is not configured on the hub yet.",
};

const STATUS: Record<string, { label: string; cls: string }> = {
  connected: { label: "OK", cls: "bg-loz-green text-loz-green-ink" },
  partial: { label: "Partly", cls: "bg-loz-yellow text-loz-yellow-ink" },
  error: { label: "Failed", cls: "bg-loz-red text-loz-red-ink" },
  not_connected: { label: "Not connected", cls: "bg-loz-grey text-loz-grey-ink" },
};

export default function GroupReportPage() {
  const [st, setSt] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [month, setMonth] = useState(lastMonth());
  const [open, setOpen] = useState<number | null>(null);
  const [params, setParams] = useSearchParams();

  const load = useCallback(async () => {
    try {
      setSt(await call<State>("/"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected || error) {
      if (connected) setNote(`Connected ${connected}.`);
      if (error) setErr(ERRORS[error] ?? "The connection did not complete.");
      setParams({}, { replace: true });
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setErr(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const connect = (s: SystemState) =>
    act(`connect:${s.key}`, async () => {
      const r = await call<{ url: string }>(`/connect/${s.key}`, { method: "POST", body: "{}" });
      location.assign(r.url);
    });
  const disconnect = (s: SystemState) =>
    act(`disconnect:${s.key}`, async () => {
      if (!confirm(`Disconnect ${s.name} from the group report?`)) return;
      const r = await call<{ note: string }>(`/disconnect/${s.key}`, { method: "POST", body: "{}" });
      setNote(r.note);
      await load();
    });
  const build = () =>
    act("build", async () => {
      const r = await call<{ id: number }>("/build", { method: "POST", body: JSON.stringify({ month }) });
      await load();
      setOpen(r.id);
    });

  const anyConnected = !!st?.systems.some((s) => s.connected);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-on" aria-hidden="true">
            <FileBarChart size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink">Group report</h1>
            <p className="text-sm text-ink-subtle">One monthly report across the companies, from each system's own company report, with your own access in each system.</p>
          </div>
        </div>
        <button type="button" className="btn-default" onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {err && (
        <div role="alert" className="rounded-lg border border-err/40 bg-err-bg p-3 text-sm text-err">
          {err}
        </div>
      )}
      {note && (
        <div role="status" className="rounded-lg border border-line bg-surface-dim p-3 text-sm text-ink">
          {note}
        </div>
      )}
      {!st && !err && <p className="text-sm text-ink-subtle">Loading…</p>}

      {st && !st.configured && (
        <div role="status" className="rounded-lg border border-line bg-warning-bg p-3 text-sm text-warning-text">
          Not configured: the hub needs its GROUP_REPORT_KEY secret before systems can be connected.
        </div>
      )}

      {st && (
        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-ink">Systems</h2>
            <p className="text-[13px] text-ink-subtle">Connect each once: you sign in to that system and click Allow there. It uses your permissions in that system.</p>
          </div>
          <ul className="divide-y divide-line">
            {st.systems.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{s.name}</span>
                    <span className={`pill ${s.connected ? (s.lastError ? STATUS.error.cls : STATUS.connected.cls) : STATUS.not_connected.cls}`}>{s.connected ? (s.lastError ? "Needs attention" : "Connected") : "Not connected"}</span>
                  </div>
                  <div className="text-xs text-ink-subtle">{s.companies.join(", ")}</div>
                  {s.connected && (
                    <div className="text-xs text-ink-subtle">
                      by {s.connectedBy ?? "—"} · {when(s.connectedAt)} · last used {when(s.lastUsedAt)}
                    </div>
                  )}
                  {s.lastError && <div className="text-xs text-err">{s.lastError}</div>}
                </div>
                <div className="flex gap-2">
                  {s.connected && (
                    <button type="button" className="btn-default" disabled={!!busy} onClick={() => void disconnect(s)}>
                      <Unlink size={14} aria-hidden="true" />
                      Disconnect
                    </button>
                  )}
                  <button type="button" className={s.connected ? "btn-default" : "btn-primary"} disabled={!!busy || !st.configured} onClick={() => void connect(s)}>
                    <Link2 size={14} aria-hidden="true" />
                    {busy === `connect:${s.key}` ? "Opening…" : s.connected ? "Reconnect" : `Connect ${s.name}`}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {st && (
        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-ink">Build a report</h2>
            <p className="text-[13px] text-ink-subtle">
              {st.schedule}
              {!st.mailReady && " Email is not set up on the hub yet, so for now the report is only kept here."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-subtle">Month</span>
              <input type="month" className="input" value={month} max={thisMonth()} min="2020-01" onChange={(e) => setMonth(e.target.value)} />
            </label>
            <button type="button" className="btn-primary" disabled={!!busy || !st.configured || !anyConnected || !month} onClick={() => void build()}>
              {busy === "build" ? "Building… (up to a minute)" : "Build report now"}
            </button>
            {!anyConnected && st.configured && <span className="text-[13px] text-ink-subtle">Connect at least one system first.</span>}
          </div>
        </section>
      )}

      {st && (
        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-ink">Past reports</h2>
          </div>
          {st.reports.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-subtle sm:px-5">No reports yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {st.reports.map((r) => (
                <li key={r.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-ink">
                        {monthName(r.month)} <span className="text-xs font-normal text-ink-subtle">· {r.kind === "scheduled" ? "monthly, automatic" : `built by ${r.builtBy ?? "—"}`} · {when(r.builtAt)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.systems.map((x) => (
                          <span key={x.key} className={`pill ${(STATUS[x.status] ?? STATUS.error).cls}`}>
                            {x.name}: {(STATUS[x.status] ?? STATUS.error).label}
                          </span>
                        ))}
                      </div>
                      {(r.emailedTo || r.note) && <div className="mt-1 text-xs text-ink-subtle">{r.emailedTo ? `Emailed to ${r.emailedTo} · ${when(r.emailedAt)}` : r.note}</div>}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className="btn-default" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? "Hide" : "View"}
                      </button>
                      <a className="btn-default" href={`/api/v1/group-report/reports/${r.id}`} target="_blank" rel="noopener">
                        Open in a tab
                      </a>
                    </div>
                  </div>
                  {open === r.id && <iframe title={`Group report ${r.month}`} src={`/api/v1/group-report/reports/${r.id}`} sandbox="allow-popups allow-popups-to-escape-sandbox" className="mt-3 h-[640px] w-full rounded-md border border-line bg-white" />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
