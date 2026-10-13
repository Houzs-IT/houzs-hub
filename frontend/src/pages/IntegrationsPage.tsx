import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { SystemTag } from "../components/Bits";
import { fmtAgo, fmtDateTime } from "../lib/format";
import { usePoll } from "../lib/usePoll";

type SystemRow = {
  code: string;
  name: string;
  active: number;
  hasKey: boolean;
  lastCallAt: string | null;
  lastSendError: string | null;
  lastSendErrorAt: string | null;
};

function Status({ s }: { s: SystemRow }) {
  if (!s.active) return <span className="pill bg-loz-grey text-loz-grey-ink">Off</span>;
  if (!s.hasKey) return <span className="pill bg-loz-red text-loz-red-ink">No key</span>;
  if (s.lastSendErrorAt) return <span className="pill bg-loz-red text-loz-red-ink">Send failed</span>;
  if (!s.lastCallAt) return <span className="pill bg-loz-orange text-loz-orange-ink">Never called</span>;
  return <span className="pill bg-loz-green text-loz-green-ink">Connected</span>;
}

function hint(s: SystemRow) {
  if (!s.active) return "Switched off; its key is refused.";
  if (!s.hasKey) return `Issue a key: npm --prefix backend run key:issue ${s.code}`;
  if (s.lastSendErrorAt) return `Last ticket send failed ${fmtAgo(s.lastSendErrorAt)}: ${s.lastSendError}`;
  if (!s.lastCallAt) return "Key issued, but the system has not used it yet.";
  return "Connected to the hub.";
}

export default function IntegrationsPage() {
  const [systems, setSystems] = useState<SystemRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ systems: SystemRow[] }>("/admin/systems")
      .then((d) => setSystems(d.systems))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  usePoll(load, 30_000);

  return (
    <div className="h-full overflow-auto px-8 py-6">
      <div className="eyebrow">IT Hub · Admin</div>
      <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">Integrations</h1>
      <p className="mt-1 text-[13px] text-ink-subtle">Whether each system is linked to the hub, based on its last call with a valid API key.</p>

      {error && <div className="mt-4 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">{error}</div>}

      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr>
              {["System", "Status", "Last call", ""].map((h, i) => (
                <th
                  key={i}
                  className="border-b-2 border-line bg-surface-dim px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-brand text-ink-subtle first:rounded-tl-[10px] first:pl-4 last:rounded-tr-[10px]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!systems && !error && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-ink-subtlest">
                  Loading...
                </td>
              </tr>
            )}
            {systems?.map((s) => (
              <tr key={s.code} className={`border-b border-line-subtle last:border-0 ${s.active ? "" : "opacity-60"}`}>
                <td className="px-3 py-2.5 pl-4">
                  <div className="flex items-center gap-2.5">
                    <SystemTag code={s.code} />
                    <span className="font-semibold text-ink">{s.name}</span>
                  </div>
                </td>
                <td className="w-32 px-3 py-2.5">
                  <Status s={s} />
                </td>
                <td className="w-36 px-3 py-2.5 text-ink-subtle" title={s.lastCallAt ? fmtDateTime(s.lastCallAt) : undefined}>
                  {s.lastCallAt ? fmtAgo(s.lastCallAt) : <span className="text-ink-subtlest">never</span>}
                </td>
                <td className="px-3 py-2.5 text-[12px] text-ink-subtlest">{hint(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
