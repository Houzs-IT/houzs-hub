import { Clock, MessageSquare } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, json, type Status, type TicketRow } from "../api/client";
import { Avatar, PriorityPill, TypeIcon } from "../components/Bits";
import { useHub } from "../components/Layout";
import ProjectShell from "../components/ProjectShell";
import { copyGhost, prefersReducedMotion, useCardMotion, type Landing } from "../lib/boardMotion";
import { fmtAgo } from "../lib/format";
import { BOARD_COLUMNS, STATUS_COLUMN_STYLE, STATUS_DOT_STYLE, STATUS_HINT, STATUS_LABEL, isReporterWaiting, systemTagStyle } from "../lib/labels";
import { useFilters } from "../lib/useFilters";
import { usePoll } from "../lib/usePoll";

// Dragging is done with pointer events, not the browser's HTML5 drag and drop: that never
// works on touch screens and some browser profiles (seen in Vivaldi) block it on desktop too.
const MOUSE_START_PX = 5;
const TOUCH_HOLD_MS = 350;
const TOUCH_SLOP_PX = 8;
const EDGE_SCROLL_PX = 48;

// Where a card lands: a column, and the card it goes above (null means the bottom).
type DropSpot = { column: Status; before: string | null };

interface Drag {
  ticket: TicketRow;
  pointerId: number;
  startX: number;
  startY: number;
  grabX: number;
  grabY: number;
  width: number;
  height: number;
  origin: DropSpot;
  isTouch: boolean;
  isActive: boolean;
}

interface Dragging {
  code: string;
  height: number;
  origin: DropSpot;
}

interface Ghost {
  ticket: TicketRow;
  left: number;
  top: number;
  width: number;
}

function isSameSpot(first: DropSpot | null, second: DropSpot | null): boolean {
  return first?.column === second?.column && first?.before === second?.before;
}

function CardBody({ ticket }: { ticket: TicketRow }): JSX.Element {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <TypeIcon type={ticket.type} />
        <span
          className={`inline-flex h-5 items-center rounded border px-1.5 font-docno text-[11px] font-semibold ${systemTagStyle(ticket.system_code)}`}
        >
          {ticket.code}
        </span>
        <span className="ml-auto">
          <PriorityPill priority={ticket.priority} />
        </span>
      </div>
      <div className="mt-2 break-words text-[14px] font-bold leading-5 text-ink">{ticket.title}</div>
      <div className="mt-3 flex items-center gap-2">
        <Avatar name={ticket.assignee_name} size={24} />
        <span className={`min-w-0 truncate text-[12px] font-semibold ${ticket.assignee_name ? "text-ink" : "text-ink-subtlest"}`}>
          {ticket.assignee_name ?? "Unassigned"}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {isReporterWaiting(ticket) && (
            <span title="The reporter replied" className="inline-flex items-center gap-1 text-xs font-medium text-primary">
              <MessageSquare className="h-3.5 w-3.5" /> Replied
            </span>
          )}
          <span
            title="Time since it was submitted"
            className="inline-flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] font-semibold text-ink-subtle"
          >
            <Clock className="h-3.5 w-3.5" /> {fmtAgo(ticket.created_at)}
          </span>
        </span>
      </div>
    </>
  );
}

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
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [spot, setSpot] = useState<DropSpot | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const drag = useRef<Drag | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  const justDropped = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const landing = useRef<Landing | null>(null);
  useCardMotion(boardRef, landing);

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

  function startDrag(e: ReactPointerEvent<HTMLDivElement>, t: TicketRow) {
    if (e.button !== 0) return;
    const isTouch = e.pointerType !== "mouse";
    const rect = e.currentTarget.getBoundingClientRect();
    const columnCards = tickets?.filter((ticket) => ticket.status === t.status) ?? [];
    const nextCard = columnCards[columnCards.findIndex((ticket) => ticket.code === t.code) + 1];
    drag.current = {
      ticket: t,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      origin: { column: t.status, before: nextCard?.code ?? null },
      isTouch,
      isActive: false,
    };
    // A finger has to hold still first, so a quick swipe still scrolls the board.
    if (isTouch) holdTimer.current = setTimeout(() => activate(e.clientX, e.clientY), TOUCH_HOLD_MS);
  }

  function activate(x: number, y: number) {
    const d = drag.current;
    if (!d) return;
    d.isActive = true;
    setDragging({ code: d.ticket.code, height: d.height, origin: d.origin });
    setGhost({ ticket: d.ticket, left: x - d.grabX, top: y - d.grabY, width: d.width });
    setSpot(dropSpotAt(x, y, d.ticket.code));
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
      setGhost((g) => g && { ...g, left: e.clientX - d.grabX, top: e.clientY - d.grabY });
      const nextSpot = dropSpotAt(e.clientX, e.clientY, d.ticket.code);
      setSpot((current) => (isSameSpot(current, nextSpot) ? current : nextSpot));
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
        const ghostCopy = ghostRef.current && !prefersReducedMotion() ? copyGhost(ghostRef.current) : null;
        if (ghostCopy) landing.current = { code: d.ticket.code, ghostCopy };
        const target = dropSpotAt(e.clientX, e.clientY, d.ticket.code);
        if (target) placeRef.current(d.ticket.code, target);
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
          const isDropTarget = dragging !== null && spot?.column === col;
          // While dragging, the cards part around an empty slot; off the board the slot stays where the card came from.
          const slot = dragging && (spot ?? dragging.origin);
          const slotBefore = slot?.column === col ? slot.before : undefined;
          const placeholder = dragging && (
            <div
              aria-hidden
              style={{ height: dragging.height }}
              className="shrink-0 rounded-[10px] border-2 border-dashed border-primary/40 bg-primary/5"
            />
          );
          const hasVisibleCard = cards.some((t) => t.code !== dragging?.code);
          return (
            <div
              key={col}
              data-column={col}
              className={`flex min-w-[272px] max-w-[360px] flex-1 shrink-0 flex-col rounded-[10px] border transition-[background-color,border-color,box-shadow] motion-reduce:transition-none ${
                isDropTarget ? "border-primary/50 bg-primary-soft shadow-[0_0_0_3px_rgb(var(--primary)/0.12)]" : STATUS_COLUMN_STYLE[col]
              }`}
            >
              <div className="flex items-start gap-2.5 px-3 pb-2 pt-3">
                <span aria-hidden className={`mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT_STYLE[col]}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-[13px] font-bold text-ink">{STATUS_LABEL[col]}</h2>
                    <span className="rounded-md border border-line bg-surface px-1.5 text-[11px] font-semibold tabular-nums leading-[18px] text-ink-subtle">
                      {cards.length}
                    </span>
                  </div>
                  <p className="truncate text-[12px] text-ink-subtle">{STATUS_HINT[col]}</p>
                </div>
              </div>
              <div data-cards className="relative flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3 pt-1.5">
                {cards.map((t, i) => {
                  // The dragged card is flattened, not removed: a touch drag stops getting move events once its starting element leaves the page.
                  const isDragSource = dragging?.code === t.code;
                  return (
                    <Fragment key={t.code}>
                      {slotBefore === t.code && placeholder}
                      <div
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
                        className={`cursor-pointer select-none rounded-[10px] border bg-surface shadow-stone outline-none [-webkit-touch-callout:none] transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary ${
                          selected === t.code ? "border-primary ring-2 ring-primary/25" : "border-line"
                        } ${isDragSource ? "-mb-2 h-0 overflow-hidden !border-0 p-0 opacity-0" : "p-3"}`}
                      >
                        <CardBody ticket={t} />
                      </div>
                    </Fragment>
                  );
                })}
                {slotBefore === null && placeholder}
                {tickets && !hasVisibleCard && slotBefore === undefined && (
                  <div className="rounded-[10px] border-2 border-dashed border-line py-6 text-center text-xs text-ink-subtle">Drop here</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {ghost && (
        <div
          ref={ghostRef}
          aria-hidden
          style={{ left: ghost.left, top: ghost.top, width: ghost.width }}
          className="pointer-events-none fixed z-[60] rotate-2 scale-[1.03] rounded-[10px] border border-primary bg-surface p-3 shadow-overlay animate-[board-lift_160ms_ease-out] motion-reduce:animate-none"
        >
          <CardBody ticket={ghost.ticket} />
        </div>
      )}
    </ProjectShell>
  );
}
