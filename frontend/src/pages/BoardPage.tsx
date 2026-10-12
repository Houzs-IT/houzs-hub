import { useCallback, useEffect, useState } from "react";
import { api, json, type Status, type TicketRow } from "../api/client";
import { Avatar, Lozenge, PriorityIcon, SystemTag, TypeIcon } from "../components/Bits";
import { useHub } from "../components/Layout";
import ProjectShell from "../components/ProjectShell";
import { sla } from "../lib/format";
import { BOARD_COLUMNS } from "../lib/labels";
import { useFilters } from "../lib/useFilters";
import { usePoll } from "../lib/usePoll";

export default function BoardPage() {
  const { version, refresh } = useHub();
  const f = useFilters();
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);

  const query = f.apiQuery({ status: BOARD_COLUMNS.join(","), page_size: "500", sort: "priority", dir: "asc" });
  query.delete("page");
  const qs = query.toString();

  const load = useCallback(() => {
    api<{ tickets: TicketRow[] }>(`/tickets?${qs}`)
      .then((d) => {
        setTickets(d.tickets);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [qs]);
  useEffect(load, [load, version]);
  usePoll(load, 30_000);

  async function move(code: string, status: Status) {
    const card = tickets?.find((t) => t.code === code);
    if (!card || card.status === status) return;
    setTickets((ts) => ts!.map((t) => (t.code === code ? { ...t, status } : t)));
    try {
      await api(`/tickets/${code}`, json("PATCH", { status }));
    } catch (e) {
      setError((e as Error).message);
    }
    refresh();
  }

  const selected = f.get("selected");

  return (
    <ProjectShell title="IT Tickets" showStatus={false}>
      {error && <div className="mb-3 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">{error}</div>}
      <div className="flex h-full min-h-[400px] gap-3">
        {BOARD_COLUMNS.map((col) => {
          const cards = tickets?.filter((t) => t.status === col) ?? [];
          return (
            <div
              key={col}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col);
              }}
              onDragLeave={() => setOver((o) => (o === col ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const code = e.dataTransfer.getData("text/plain");
                if (code) move(code, col);
              }}
              className={`flex w-[272px] shrink-0 flex-col rounded-[10px] border transition-colors ${
                over === col && dragging ? "border-primary/50 bg-primary-soft" : "border-line bg-surface-dim/60"
              }`}
            >
              <div className="flex items-center gap-2 px-3 pb-2 pt-3">
                <Lozenge status={col} />
                <span className="text-[11px] font-semibold tabular-nums text-ink-subtlest">{cards.length}</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3">
                {cards.map((t) => {
                  const s = sla(t.created_at, t.priority, t.status);
                  return (
                    <div
                      key={t.code}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", t.code);
                        setDragging(t.code);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => f.set({ selected: t.code })}
                      className={`cursor-pointer rounded-[10px] border bg-surface p-3 shadow-stone transition-colors hover:border-primary/50 ${
                        selected === t.code ? "border-primary ring-2 ring-primary/25" : "border-line"
                      } ${dragging === t.code ? "opacity-50" : ""}`}
                    >
                      <div className="text-[13px] font-medium leading-5 text-ink">{t.title}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <SystemTag code={t.system_code} />
                        {s?.overdue && (
                          <span className="pill bg-loz-red text-loz-red-ink">
                            {s.label}
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5 flex items-center gap-1.5">
                        <TypeIcon type={t.type} />
                        <span className="font-docno text-[12px] font-semibold text-accent">{t.code}</span>
                        <span className="ml-auto flex items-center gap-1.5">
                          <PriorityIcon priority={t.priority} />
                          <Avatar name={t.assignee_name} size={24} />
                        </span>
                      </div>
                    </div>
                  );
                })}
                {tickets && cards.length === 0 && (
                  <div className="rounded-[10px] border-2 border-dashed border-line py-6 text-center text-xs text-ink-subtlest">Drop here</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ProjectShell>
  );
}
