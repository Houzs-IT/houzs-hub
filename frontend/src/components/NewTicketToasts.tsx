import { Inbox, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type TicketRow } from "../api/client";
import { PRIORITY_LABEL } from "../lib/labels";
import { usePoll } from "../lib/usePoll";
import { PriorityIcon, SystemTag } from "./Bits";
import { useHub } from "./Layout";

const SHOW_MS = 8_000;

// A short two-note chime. Browsers mute it until the user has clicked the page once.
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + i * 0.12;
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.08, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.3);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {}
}

// Watches for tickets created since this page opened, pops a toast for each
// and refreshes every open view so the new ticket shows without a reload.
// ponytail: 10s poll, not push; a Durable Object with WebSockets if seconds matter.
export default function NewTicketToasts() {
  const { systems, refresh } = useHub();
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<TicketRow[]>([]);
  const seen = useRef<string | null>(null);

  const check = useCallback(() => {
    api<{ tickets: TicketRow[] }>("/tickets?sort=created&dir=desc&page_size=5")
      .then(({ tickets }) => {
        const newest = tickets[0]?.created_at ?? "";
        // First check only sets the starting point: no toasts for old tickets.
        if (seen.current === null) return void (seen.current = newest);
        const fresh = tickets.filter((t) => t.created_at > seen.current!);
        if (!fresh.length) return;
        seen.current = newest;
        setToasts((list) => [...fresh, ...list].slice(0, 3));
        chime();
        refresh();
      })
      .catch(() => {});
  }, [refresh]);
  useEffect(check, [check]);
  usePoll(check, 10_000);

  const dismiss = (code: string) => setToasts((list) => list.filter((t) => t.code !== code));

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-3" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.code} t={t} systemName={systems.find((s) => s.code === t.system_code)?.name} onClose={() => dismiss(t.code)}
          onView={() => {
            dismiss(t.code);
            navigate(`/tickets/${t.code}`);
          }}
        />
      ))}
    </div>
  );
}

function Toast({ t, systemName, onClose, onView }: { t: TicketRow; systemName?: string; onClose: () => void; onView: () => void }) {
  // Hovering pauses the countdown so the toast does not vanish while being read.
  const [hover, setHover] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (hover) return;
    const id = setTimeout(() => close.current(), SHOW_MS);
    return () => clearTimeout(id);
  }, [hover]);

  return (
    <div className="card p-4" role="status" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="flex items-center gap-2">
        <Inbox className="h-4 w-4 text-primary" />
        <span className="flex-1 text-[10.5px] font-bold uppercase tracking-brand text-primary">New ticket submitted</span>
        <button className="text-ink-subtlest hover:text-ink" onClick={onClose} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-subtle">
        <span className="font-docno font-semibold text-accent">{t.code}</span>
        <span>·</span>
        <SystemTag code={t.system_code} />
        {systemName && <span className="truncate">{systemName}</span>}
      </div>
      <div className="mt-1.5 line-clamp-2 text-sm font-semibold text-ink">"{t.title}"</div>
      <div className="mt-1.5 space-y-0.5 text-xs text-ink-subtle">
        <div>Reported by: <span className="text-ink">{t.reporter_name}</span></div>
        <div className="flex items-center gap-1">
          Priority: <PriorityIcon priority={t.priority} /> <span className="text-ink">{PRIORITY_LABEL[t.priority]}</span>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-default" onClick={onClose}>
          Dismiss
        </button>
        <button className="btn-primary" onClick={onView}>
          View ticket
        </button>
      </div>
    </div>
  );
}
