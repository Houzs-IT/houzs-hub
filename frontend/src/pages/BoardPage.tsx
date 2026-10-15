import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, json, type Status, type TicketRow } from "../api/client";
import { Avatar, Lozenge, PriorityIcon, SystemTag, TypeIcon } from "../components/Bits";
import { useHub } from "../components/Layout";
import ProjectShell from "../components/ProjectShell";
import { fmtAgo } from "../lib/format";
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

// Where a card lands: a column, and the card it goes above (null means the bottom).
type DropSpot = { column: Status; before: string | null };

function dropSpotAt(x: number, y: number, draggedCode: string): DropSpot | null {
  const column = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-column]");
  if (!column) return null;
  const below = [...column.querySelectorAll<HTMLElement>("[data-card]")].find((card) => {
    if (card.dataset.card === draggedCode) return false;
    const rect = card.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  return { column: column.dataset.column as Status, before: below?.dataset.card ?? null };
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
  const [spot, setSpot] = useState<DropSpot | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  const justDropped = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);

  // ponytail: one capped page across all columns; switch to per-column pages with "show more" past ~200 open tickets.
  const query = f.apiQuery({ status: BOARD_COLUMNS.join(","), page_size: "200", sort: "board" });
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

  // The tickets array is in display order, so splicing the card in is the new column order.
  async function place(code: string, { column, before }: DropSpot) {
    const card = tickets?.find((t) => t.code === code);
    if (!tickets || !card) return;
    const next = tickets.filter((t) => t.code !== code);
    const at = before ? next.findIndex((t) => t.code === before) : -1;
    next.splice(at < 0 ? next.length : at, 0, { ...card, status: column });
    const codesIn = (list: TicketRow[]) => list.filter((t) => t.status === column).map((t) => t.code);
    const codes = codesIn(next);
    if (card.status === column && codes.join() === codesIn(tickets).join()) return;

    setMoveError(null);
    setTickets(next);
    try {
      if (card.status !== column) await api(`/tickets/${code}`, json("PATCH", { status: column }));
      await api("/tickets/reorder", json("POST", { codes }));
      refresh();
    } catch (e) {
      setMoveError(`${code} was not moved: ${(e as Error).message}`);
      load();
    }
  }

  const placeRef = useRef(place);
  placeRef.current = place;

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
    setSpot(dropSpotAt(x, y, d.code));
  }

  function endDrag() {
    clearTimeout(holdTimer.current);
    drag.current = null;
    setDragging(null);
    setGhost(null);
    setSpot(null);
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
      setSpot(dropSpotAt(e.clientX, e.clientY, d.code));
      // Near the board's left or right edge, scroll it so off-screen columns can be reached.
      const scroller = boardRef.current?.parentElement;
      const rect = scroller?.getBoundingClientRect();
      if (scroller && rect) {
        if (e.clientX < rect.left + EDGE_SCROLL_PX) scroller.scrollBy({ left: -16 });
        else if (e.clientX > rect.right - EDGE_SCROLL_PX) scroller.scrollBy({ left: 16 });
      }
      // Same for the top and bottom of a long column, so a finger can reach every slot.
      const list = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-column]")?.querySelector<HTMLElement>("[data-cards]");
      const listRect = list?.getBoundingClientRect();
      if (list && listRect) {
        if (e.clientY < listRect.top + EDGE_SCROLL_PX) list.scrollBy({ top: -16 });
        else if (e.clientY > listRect.bottom - EDGE_SCROLL_PX) list.scrollBy({ top: 16 });
      }
    }
    function onUp(e: PointerEvent) {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (d.isActive) {
        // The click that follows a drop must not also open the ticket.
        justDropped.current = true;
        setTimeout(() => (justDropped.current = false));
        const target = dropSpotAt(e.clientX, e.clientY, d.code);
        if (target) placeRef.current(d.code, target);
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
          Showing {tickets.length} of {total} tickets. Use the filters to narrow it down.
        </div>
      )}
      {!tickets && !error && <div className="py-16 text-center text-sm text-ink-subtle">Loading...</div>}
      <div ref={boardRef} className={`flex h-full min-h-[400px] gap-3 ${dragging ? "cursor-grabbing select-none" : ""}`}>
        {BOARD_COLUMNS.map((col) => {
          const cards = tickets?.filter((t) => t.status === col) ?? [];
          const dropLine = dragging && spot?.column === col ? spot.before : undefined;
          return (
            <div
              key={col}
              data-column={col}
              className={`flex min-w-[272px] max-w-[360px] flex-1 shrink-0 flex-col rounded-[10px] border transition-colors ${
                dropLine !== undefined ? "border-primary/50 bg-primary-soft" : "border-line bg-surface-dim/60"
              }`}
            >
              <div className="flex items-center gap-2 px-3 pb-2 pt-3">
                <Lozenge status={col} />
                <span className="text-[11px] font-semibold tabular-nums text-ink-subtlest">{cards.length}</span>
              </div>
              <div data-cards className="flex-1 space-y-2 overflow-y-auto px-2 pb-3 pt-1.5">
                {cards.map((t, i) => {
                  return (
                    <div
                      key={t.code}
                      data-card={t.code}
                      onPointerDown={(e) => startDrag(e, t)}
                      onClick={() => !justDropped.current && f.set({ selected: t.code })}
                      onDoubleClick={() => navigate(`/tickets/${t.code}`)}
                      role="button"
                      tabIndex={0}
                      aria-label={`${t.code} ${t.title}`}
                      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                      onKeyDown={(e) => {
                        // Alt+Up / Alt+Down moves the card one place, for keyboards and screen readers.
                        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                          e.preventDefault();
                          const target = e.key === "ArrowUp" ? i - 1 : i + 2;
                          if (target < 0 || target > cards.length) return;
                          place(t.code, { column: col, before: cards[target]?.code ?? null });
                          requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card="${t.code}"]`)?.focus());
                          return;
                        }
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        f.set({ selected: t.code });
                      }}
                      className={`relative cursor-pointer select-none rounded-[10px] border bg-surface p-3 shadow-stone outline-none [-webkit-touch-callout:none] transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary ${
                        selected === t.code ? "border-primary ring-2 ring-primary/25" : "border-line"
                      } ${dragging === t.code ? "opacity-50" : ""}`}
                    >
                      {/* Drawn in the gap between cards, so showing it never shifts the card under the pointer. */}
                      {dropLine === t.code && <span aria-hidden className="absolute inset-x-0 -top-[5px] h-0.5 rounded bg-primary" />}
                      {dropLine === null && i === cards.length - 1 && (
                        <span aria-hidden className="absolute inset-x-0 -bottom-[5px] h-0.5 rounded bg-primary" />
                      )}
                      <div className="break-words text-[13px] font-medium leading-5 text-ink">{t.title}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <SystemTag code={t.system_code} />
                        {isReporterWaiting(t) && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                            <MessageSquare className="h-3.5 w-3.5" /> Replied
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5 flex items-center gap-1.5">
                        <TypeIcon type={t.type} />
                        <span className="font-docno text-[12px] font-semibold text-accent">{t.code}</span>
                        <span className="text-[11px] text-ink-subtle">· {fmtAgo(t.created_at)}</span>
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
