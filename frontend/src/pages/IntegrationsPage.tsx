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

function Hint({ s }: { s: SystemRow }) {
  if (!s.active) return <>Switched off; its key is refused.</>;
  if (!s.hasKey) {
    return (
      <>
        Issue a key from the repo:
        <code className="mt-1 block select-all break-all rounded-md border border-line bg-surface-2 px-2 py-1 font-docno text-[12px] text-ink">
          npm --prefix backend run key:issue -- {s.code}
        </code>
      </>
    );
  }
  if (s.lastSendErrorAt) {
    return (
      <>
        Last ticket send failed {fmtAgo(s.lastSendErrorAt)}:
        <span className="mt-1 block break-words text-loz-red-ink">{s.lastSendError}</span>
      </>
    );
  }
  if (!s.lastCallAt) return <>Key issued, but the system has not used it yet.</>;
  return <>Connected to the hub.</>;
}

export default function IntegrationsPage() {
  const [systems, setSystems] = useState<SystemRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ systems: SystemRow[] }>("/admin/systems")
      .then((d) => {
        setSystems(d.systems);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  usePoll(load, 60_000);

  return (
    <div className="h-full overflow-auto px-4 py-6 md:px-8">
      <div className="eyebrow">IT Hub · Admin</div>
      <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">Integrations</h1>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-subtle">
        Whether each system is linked to the hub, based on its last call with a valid API key. Refreshes every minute.
      </p>

      {error && (
        <div role="alert" className="mt-4 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
          {error}
        </div>
      )}

      {!systems && !error && <div className="py-16 text-center text-sm text-ink-subtlest">Loading...</div>}
      {systems?.length === 0 && <div className="py-16 text-center text-sm text-ink-subtlest">No systems are set up yet.</div>}

      <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
        {systems?.map((s) => (
          <section key={s.code} className={`card p-4 ${s.active ? "" : "opacity-60"}`} aria-label={s.name}>
            <div className="flex items-center gap-2.5">
              <SystemTag code={s.code} />
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{s.name}</span>
              <Status s={s} />
            </div>
            <div className="mt-2 text-xs text-ink-subtle">
              Last call{" "}
              {s.lastCallAt ? (
                <time dateTime={s.lastCallAt} title={fmtDateTime(s.lastCallAt)}>
                  {fmtAgo(s.lastCallAt)}
                </time>
              ) : (
                "never"
              )}
            </div>
            <div className="mt-3 border-t border-line-subtle pt-3 text-[12.5px] text-ink-subtle">
              <Hint s={s} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
