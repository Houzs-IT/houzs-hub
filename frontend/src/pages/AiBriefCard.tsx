// ---------------------------------------------------------------------------
// The "Emails from the AI Connector" card on /ai-connector (round 4d D1 / D2 / D4):
// your own morning brief and urgent alerts, opt-in, default off. Built as you, from what
// your own login sees. Preview (not sent), a test brief to yourself, the thresholds
// (read-only, one place on the server: services/proactive.ts PROACTIVE_CONFIG) and the
// last emails sent. Every rule is the server's (backend routes/proactive.ts).
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { Eye, Mail, Send } from "lucide-react";

type Sub = { briefEnabled: boolean; briefTime: string; briefDays: "weekdays" | "daily"; alertsEnabled: boolean };
type Sent = { kind: string; day: string; items: number; status: string; note: string; at: string };
type State = { allowed: boolean; email: string; mailReady: boolean; saved: boolean; subscription: Sub; thresholds: string[]; schedule: string; recent: Sent[] };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/ai-brief/me${path}`, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) {
    location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    return new Promise<T>(() => {});
  }
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`).filter((t) => t >= "05:00" && t <= "22:00");
const KIND: Record<string, string> = { brief: "Morning brief", brief_test: "Test brief", alert: "Alert" };

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-[13px] text-ink-subtle">{hint}</span>
      </span>
    </label>
  );
}

export default function AiBriefCard() {
  const [st, setSt] = useState<State | null>(null);
  const [form, setForm] = useState<Sub | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "preview" | "test">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await call<State>("");
      setSt(s);
      setForm(s.subscription);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (kind: "save" | "preview" | "test") => {
    if (!form) return;
    setBusy(kind);
    setMsg(null);
    try {
      if (kind === "save") {
        await call("", { method: "PUT", body: JSON.stringify(form) });
        setMsg({ ok: true, text: form.briefEnabled || form.alertsEnabled ? "Saved. Emails go to your hub address." : "Saved. Both emails are off." });
        await load();
      } else if (kind === "preview") {
        setPreview(await call<{ subject: string; html: string }>("/preview"));
      } else {
        const r = await call<{ sentTo: string }>("/test", { method: "POST", body: "{}" });
        setMsg({ ok: true, text: `Test brief sent to ${r.sentTo}.` });
        await load();
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy("");
    }
  };

  if (!st || !form) return msg ? <p className="text-sm text-err">{msg.text}</p> : null;
  if (!st.allowed) return null;
  const dirty = JSON.stringify(form) !== JSON.stringify(st.subscription) || !st.saved;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <Mail size={16} className="text-ink-subtle" aria-hidden="true" />
            Emails from the AI Connector
          </h2>
          <p className="text-[13px] text-ink-subtle">Built as you, from only what your own login can see. Both are off until you turn them on.</p>
        </div>
      </div>
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        {!st.mailReady && (
          <div role="status" className="rounded-md border border-line bg-surface-dim p-3 text-[13px] text-ink-subtle">
            Email is not set up on the hub yet, so nothing is sent for now. You can still save your choice and preview the brief.
          </div>
        )}
        {!st.email && <p className="text-[13px] text-err">Your hub account has no email address. Ask an admin to add one before turning these on.</p>}

        <Toggle checked={form.briefEnabled} onChange={(v) => setForm({ ...form, briefEnabled: v })} label="Morning brief" hint="Your open tickets, urgent tickets nobody has, your meetings today and unread notifications. Monday adds the data gaps." />
        {form.briefEnabled && (
          <div className="ml-7 flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-ink-subtle">At</span>
              <select className="input" value={form.briefTime} onChange={(e) => setForm({ ...form, briefTime: e.target.value })}>
                {TIMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-ink-subtle">Malaysia time,</span>
            <select className="input" value={form.briefDays} onChange={(e) => setForm({ ...form, briefDays: e.target.value as Sub["briefDays"] })} aria-label="Which days">
              <option value="weekdays">Monday to Friday</option>
              <option value="daily">Every day</option>
            </select>
          </div>
        )}
        <Toggle checked={form.alertsEnabled} onChange={(v) => setForm({ ...form, alertsEnabled: v })} label="Urgent alerts" hint="An email when something needs action now (rules below). Each alert at most once a day." />

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={!!busy || !dirty} onClick={() => void run("save")}>
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn-default" disabled={!!busy} onClick={() => void run("preview")}>
            <Eye size={14} aria-hidden="true" />
            {busy === "preview" ? "Building…" : "Preview my brief"}
          </button>
          <button type="button" className="btn-default" disabled={!!busy || !st.mailReady || !st.email} onClick={() => void run("test")} title={st.mailReady ? `Sends to ${st.email} only` : "Email is not set up yet"}>
            <Send size={14} aria-hidden="true" />
            {busy === "test" ? "Sending…" : "Send me a test brief"}
          </button>
        </div>
        {msg && (
          <p role="status" className={msg.ok ? "text-[13px] text-synced" : "text-[13px] text-err"}>
            {msg.text}
          </p>
        )}

        {preview && (
          <div className="rounded-md border border-line">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
              <span className="min-w-0 truncate text-[13px] font-medium text-ink">{preview.subject}</span>
              <button type="button" className="btn-subtle" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            {/* The email exactly as built; sandboxed: no scripts, links open in a new tab. */}
            <iframe title="Brief preview" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={preview.html.replace("<head>", '<head><base target="_blank">')} className="h-[480px] w-full bg-white" />
          </div>
        )}

        <details className="text-[13px] text-ink-subtle">
          <summary className="cursor-pointer text-ink">When alerts fire and when emails go out</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {st.thresholds.map((t) => (
              <li key={t}>{t}</li>
            ))}
            <li>{st.schedule}</li>
          </ul>
        </details>

        {st.recent.length > 0 && (
          <div>
            <h3 className="section-title mb-1">Last emails</h3>
            <ul className="divide-y divide-line text-[13px]">
              {st.recent.map((r, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span className="text-ink">
                    {KIND[r.kind] ?? r.kind} · {r.day}
                    {r.items ? ` · ${r.items} item${r.items === 1 ? "" : "s"}` : ""}
                  </span>
                  <span className={r.status === "failed" ? "text-err" : "text-ink-subtle"}>
                    {r.status}
                    {r.note ? `: ${r.note}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
