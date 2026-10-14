import { Inbox, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type TicketRow } from "../api/client";
import { PRIORITY_LABEL } from "../lib/labels";
import { usePoll } from "../lib/usePoll";
import { PriorityIcon, SystemTag } from "./Bits";
import { useHub } from "./Layout";

const TOAST_DURATION_MS = 8_000;
const BACKUP_CHECK_MS = 60_000;
const RECONNECT_DELAY_MS = 10_000;
const MAX_TOASTS = 3;

function playChime() {
  try {
    const audio = new AudioContext();
    [880, 1320].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      const startAt = audio.currentTime + index * 0.12;
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, startAt);
      volume.gain.exponentialRampToValueAtTime(0.08, startAt + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.3);
      oscillator.connect(volume).connect(audio.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.3);
    });
    setTimeout(() => audio.close(), 800);
  } catch {}
}

// Ticket news arrives over the live socket; the backup check catches anything sent while it was down.
export default function NewTicketToasts() {
  const { systems, refresh } = useHub();
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<TicketRow[]>([]);
  const newestSeenAt = useRef<string | null>(null);

  const showNewTickets = useCallback(
    (tickets: TicketRow[]) => {
      const seenUpTo = newestSeenAt.current;
      if (seenUpTo === null) return;
      const newTickets = tickets.filter((ticket) => ticket.created_at > seenUpTo);
      if (!newTickets.length) return;
      newestSeenAt.current = newTickets.reduce((newest, ticket) => (ticket.created_at > newest ? ticket.created_at : newest), seenUpTo);
      setToasts((current) => [...newTickets, ...current].slice(0, MAX_TOASTS));
      playChime();
      refresh();
    },
    [refresh],
  );

  const checkForNewTickets = useCallback(
    () =>
      api<{ tickets: TicketRow[] }>("/tickets?sort=created&dir=desc&page_size=5")
        .then(({ tickets }) => {
          if (newestSeenAt.current === null) newestSeenAt.current = tickets[0]?.created_at ?? "";
          else showNewTickets(tickets);
        })
        .catch(() => {}),
    [showNewTickets],
  );
  usePoll(checkForNewTickets, BACKUP_CHECK_MS);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let isStopped = false;

    function connect() {
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${location.host}/api/v1/dev/live`);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ticket.created") showNewTickets([message.ticket]);
          if (message.type === "tickets.changed") refresh();
        } catch {}
      };
      socket.onclose = () => {
        if (isStopped) return;
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        checkForNewTickets();
      };
    }

    // Connect only after the first check, so tickets that already existed never toast.
    checkForNewTickets().finally(() => !isStopped && connect());
    return () => {
      isStopped = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [showNewTickets, checkForNewTickets, refresh]);

  const dismiss = (code: string) => setToasts((current) => current.filter((ticket) => ticket.code !== code));

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-3" aria-live="polite">
      {toasts.map((ticket) => (
        <Toast
          key={ticket.code}
          ticket={ticket}
          systemName={systems.find((system) => system.code === ticket.system_code)?.name}
          onClose={() => dismiss(ticket.code)}
          onView={() => {
            dismiss(ticket.code);
            navigate(`/tickets/${ticket.code}`);
          }}
        />
      ))}
    </div>
  );
}

type ToastProps = { ticket: TicketRow; systemName?: string; onClose: () => void; onView: () => void };

function Toast({ ticket, systemName, onClose, onView }: ToastProps) {
  const [isHovered, setIsHovered] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (isHovered) return;
    const timer = setTimeout(() => onCloseRef.current(), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [isHovered]);

  return (
    <div className="card p-4" role="status" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <div className="flex items-center gap-2">
        <Inbox className="h-4 w-4 text-primary" />
        <span className="flex-1 text-[10.5px] font-bold uppercase tracking-brand text-primary">New ticket submitted</span>
        <button className="tap -m-1 grid place-items-center p-1 text-ink-subtlest hover:text-ink" onClick={onClose} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-subtle">
        <span className="font-docno font-semibold text-accent">{ticket.code}</span>
        <span>·</span>
        <SystemTag code={ticket.system_code} />
        {systemName && <span className="truncate">{systemName}</span>}
      </div>
      <div className="mt-1.5 line-clamp-2 text-sm font-semibold text-ink">"{ticket.title}"</div>
      <div className="mt-1.5 space-y-0.5 text-xs text-ink-subtle">
        <div>
          Reported by: <span className="text-ink">{ticket.reporter_name}</span>
        </div>
        <div className="flex items-center gap-1">
          Priority: <PriorityIcon priority={ticket.priority} /> <span className="text-ink">{PRIORITY_LABEL[ticket.priority]}</span>
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
