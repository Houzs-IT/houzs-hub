import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, json, type Status, type TicketRow } from "../api/client";
import { Avatar, Lozenge, PriorityIcon, SystemTag, TypeIcon } from "../components/Bits";
import { useHub } from "../components/Layout";
import ProjectShell from "../components/ProjectShell";
import { sla } from "../lib/format";
import { BOARD_COLUMNS, isReporterWaiting } from "../lib/labels";
import { useFilters } from "../lib/useFilters";
import { usePoll } from "../lib/usePoll";

// Dragging is done with pointer events, not the browser's HTML5 drag and drop: that never
// works on touch screens and some browser profiles (seen in Vivaldi) block it on desktop too.
const MOUSE_START_PX = 5;
const TOUCH_HOLD_MS = 350;
const TOUCH_SLOP_PX = 8;
const EDGE_SCROLL_PX = 48;

type Drag = { code: string; title: string; pointerId: number; startX: number; startY: number; isTouch: boolean; isActive: boolean };

function columnAt(x: number, y: number) {
  return (document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-column]")?.dataset.column as Status | undefined) ?? null;
}

export default function BoardPage() {
  const { version, refresh } = useHub();
  const f = useFilters();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from `error` so the reload after a refused move cannot wipe the reason.
  const [moveError, setMoveError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  const justDropped = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);

  // ponytail: one capped page across all columns; switch to per-column pages with "show more" past ~200 open tickets.
  const query = f.apiQuery({ status: BOARD_COLUMNS.join(","), page_size: "200", sort: "priority", dir: "asc" });
  query.delete("page");
  const qs = query.toString();

  const load = useCallback(() => {
    api<{ tickets: TicketRow[]; total: number }>(`/tickets?${qs}`)
      .then((d) => {
        setTickets(d.tickets);
        setTotal(d.total);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [qs]);
  useEffect(load, [load, version]);
  usePoll(load, 60_000);

  async function move(code: string, status: Status) {
    const card = tickets?.find((t) => t.code === code);
    if (!card || card.status === status) return;
    setMoveError(null);
    setTickets((ts) => ts!.map((t) => (t.code === code ? { ...t, status } : t)));
    try {
      await api(`/tickets/${code}`, json("PATCH", { status }));
      refresh();
    } catch (e) {
      setMoveError(`${code} was not moved: ${(e as Error).message}`);
      load();
    }
  }

  const moveRef = useRef(move);
  moveRef.current = move;

  function startDrag(e: ReactPointerEvent, t: TicketRow) {
    if (e.button !== 0) return;
    const isTouch = e.pointerType !== "mouse";
    drag.current = { code: t.code, title: t.title, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, isTouch, isActive: false };
    // A finger has to hold still first, so a quick swipe still scrolls the board.
    if (isTouch) holdTimer.current = setTimeout(() => activate(e.clientX, e.clientY), TOUCH_HOLD_MS);
  }

  function activate(x: number, y: number) {
    const d = drag.current;
    if (!d) return;
    d.isActive = true;
    setDragging(d.code);
    setGhost({ title: d.title, x, y });
    setOver(columnAt(x, y));
  }

  function endDrag() {
    clearTimeout(holdTimer.current);
    drag.current = null;
    setDragging(null);
    setGhost(null);
    setOver(null);
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const distance = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (!d.isActive) {
        if (d.isTouch) {
          if (distance > TOUCH_SLOP_PX) endDrag();
        } else if (distance >= MOUSE_START_PX) activate(e.clientX, e.clientY);
        return;
      }
      setGhost((g) => g && { ...g, x: e.clientX, y: e.clientY });
      setOver(columnAt(e.clientX, e.clientY));
      // Near the board's left or right edge, scroll it so off-screen columns can be reached.
      const scroller = boardRef.current?.parentElement;
      const rect = scroller?.getBoundingClientRect();
      if (scroller && rect) {
        if (e.clientX < rect.left + EDGE_SCROLL_PX) scroller.scrollBy({ left: -16 });
        else if (e.clientX > rect.right - EDGE_SCROLL_PX) scroller.scrollBy({ left: 16 });
      }
    }
    function onUp(e: PointerEvent) {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (d.isActive) {
        // The click that follows a drop must not also open the ticket.
        justDropped.current = true;
        setTimeout(() => (justDropped.current = false));
        const column = columnAt(e.clientX, e.clientY);
        if (column) moveRef.current(d.code, column);
      }
      endDrag();
    }
    function onCancel(e: PointerEvent) {
      if (drag.current?.pointerId === e.pointerId) endDrag();
    }
    // Once a held card is moving, the finger drags the card instead of scrolling the page.
    function onTouchMove(e: TouchEvent) {
      if (drag.current?.isActive) e.preventDefault();
    }
    function onContextMenu(e: Event) {
      if (drag.current?.isTouch) e.preventDefault();
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("contextmenu", onContextMenu);
      clearTimeout(holdTimer.current);
    };
  }, []);

  const selected = f.get("selected");
  const shownError = moveError ?? error;

  return (
    <ProjectShell view="Board" showStatus={false}>
      {shownError && (
        <div role="alert" className="mb-3 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
          {shownError}
        </div>
      )}
      {tickets && total > tickets.length && (
        <div className="mb-3 text-[12.5px] text-ink-subtle">
          Showing the {tickets.length} most urgent of {total} tickets. Use the filters to narrow it down.
        </div>
      )}
      {!tickets && !error && <div className="py-16 text-center text-sm text-ink-subtle">Loading...</div>}
      <div ref={boardRef} className={`flex h-full min-h-[400px] gap-3 ${dragging ? "cursor-grabbing select-none" : ""}`}>
        {BOARD_COLUMNS.map((col) => {
          const cards = tickets?.filter((t) => t.status === col) ?? [];
          return (
            <div
              key={col}
              data-column={col}
              className={`flex min-w-[272px] max-w-[360px] flex-1 shrink-0 flex-col rounded-[10px] border transition-colors ${
                over === col && dragging ? "border-primary/50 bg-primary-soft" : "border-line bg-surface-dim/60"
              }`}
            >
              <div className="flex items-center gap-2 px-3 pb-2 pt-3">
                <Lozenge status={col} />
                <span className="text-[11px] font-semibold tabular-nums text-ink-subtlest">{cards.length}</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3">
                {cards.map((t) => {
                  const s = sla(t.created_at, t.priority, t.status, t.legacy_code);
                  return (
                    <div
                      key={t.code}
                      onPointerDown={(e) => startDrag(e, t)}
                      onClick={() => !justDropped.current && f.set({ selected: t.code })}
                      onDoubleClick={() => navigate(`/tickets/${t.code}`)}
                      role="button"
                      tabIndex={0}
                      aria-label={`${t.code} ${t.title}`}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        f.set({ selected: t.code });
                      }}
                      className={`cursor-pointer select-none rounded-[10px] border bg-surface p-3 shadow-stone outline-none [-webkit-touch-callout:none] transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary ${
                        selected === t.code ? "border-primary ring-2 ring-primary/25" : "border-line"
                      } ${dragging === t.code ? "opacity-50" : ""}`}
                    >
                      <div className="break-words text-[13px] font-medium leading-5 text-ink">{t.title}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <SystemTag code={t.system_code} />
                        {isReporterWaiting(t) && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                            <MessageSquare className="h-3.5 w-3.5" /> Replied
                          </span>
                        )}
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
                  <div className="rounded-[10px] border-2 border-dashed border-line py-6 text-center text-xs text-ink-subtle">Drop here</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {ghost && (
        <div
          aria-hidden
          style={{ left: ghost.x, top: ghost.y }}
          className="pointer-events-none fixed z-50 w-[240px] -translate-x-1/2 -translate-y-1/2 rotate-2 rounded-[10px] border border-primary bg-surface p-3 text-[13px] font-medium leading-5 text-ink shadow-overlay"
        >
          <span className="line-clamp-2">{ghost.title}</span>
        </div>
      )}
    </ProjectShell>
  );
}
