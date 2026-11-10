import { KanbanSquare, List, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { prefersReducedMotion } from "../lib/boardMotion";
import { useFilters } from "../lib/useFilters";
import IssueView from "./IssueView";
import NewTicketDialog from "./NewTicketDialog";
import { useHub } from "./Layout";
import Toolbar from "./Toolbar";

const DRAWER_OUT_MS = 180;

// Header + view tabs + filters + optional issue side panel, shared by List / Board / My queue.
export default function ProjectShell({
  view,
  children,
  showStatus = true,
  showAssignee = true,
}: {
  view: "List" | "Board" | "My queue";
  children: ReactNode;
  showStatus?: boolean;
  showAssignee?: boolean;
}) {
  const f = useFilters();
  const { systems } = useHub();
  // Opened from a system in the sidebar: the system names the page and the view moves to the eyebrow.
  const systemCodes = f.list("system");
  const system = view !== "My queue" && systemCodes.length === 1 ? systems.find((s) => s.code === systemCodes[0]) : undefined;
  const activeSystems = systems.filter((candidate) => candidate.active === 1);
  const [isCreating, setIsCreating] = useState(false);
  const { search } = useLocation();
  const selected = f.get("selected");
  const keep = new URLSearchParams(search);
  keep.delete("selected");
  keep.delete("page");
  const qs = keep.toString() ? `?${keep}` : "";
  // My queue's "assigned to me" lives in code, not the URL, so carry it over to the Board.
  const boardKeep = new URLSearchParams(keep);
  if (view === "My queue") boardKeep.set("assignee", "me");
  const boardQs = boardKeep.toString() ? `?${boardKeep}` : "";

  const drawerRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closePanel = (): void => f.set({ selected: null });
  const closePanelRef = useRef(closePanel);
  closePanelRef.current = closePanel;

  // A closed panel stays mounted while it slides away, so the ticket does not vanish mid-animation.
  const [closingCode, setClosingCode] = useState<string | null>(null);
  const lastShown = useRef<string | null>(null);
  useEffect(() => {
    if (selected) {
      lastShown.current = selected;
      setClosingCode(null);
      return;
    }
    if (!lastShown.current || prefersReducedMotion()) {
      lastShown.current = null;
      return;
    }
    setClosingCode(lastShown.current);
    lastShown.current = null;
    const done = setTimeout(() => setClosingCode(null), DRAWER_OUT_MS);
    return () => clearTimeout(done);
  }, [selected]);
  const shownCode = selected ?? closingCode;
  const isClosing = !selected && closingCode !== null;

  // Focus moves into the panel when it opens and back to the card or row that opened it on close.
  // Opening another ticket while it is open leaves focus where it is, so browsing stays on the list or board.
  const isOpen = Boolean(selected);
  useEffect(() => {
    if (!isOpen) {
      opener.current?.focus({ preventScroll: true });
      opener.current = null;
      return;
    }
    if (document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
    drawerRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  // Escape closes the drawer, unless a menu, the delete dialog or a text field should get it first.
  useEffect(() => {
    if (!selected) return;
    function closeOnEscape(e: KeyboardEvent): void {
      if (e.key !== "Escape") return;
      const isInField = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (isInField || document.querySelector("dialog[open], [role=menu], [role=listbox], [aria-modal=true]")) return;
      closePanelRef.current();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  // Century FilterPills segmented control: petrol fill on the active segment.
  const tab = ({ isActive }: { isActive: boolean }) =>
    `tap flex items-center gap-1.5 whitespace-nowrap rounded px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors duration-150 ${
      isActive ? "bg-primary text-primary-on shadow-sm" : "text-ink-subtle hover:bg-primary-soft hover:text-primary"
    }`;

  return (
    <div className="relative flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phones shrink the title so the List/Board switch shares its row. */}
        <div className="px-4 pt-4 sm:pt-6 md:px-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="eyebrow">Houzs Hub · Tickets{system && ` · ${view}`}</div>
              <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:mt-1 sm:text-[24px]">{system?.name ?? view}</h1>
            </div>
            <div className="flex items-stretch gap-2">
              {activeSystems.length > 0 && (
                <button type="button" className="btn-primary h-auto" onClick={() => setIsCreating(true)}>
                  <Plus className="h-4 w-4" /> New ticket
                </button>
              )}
              <div className="inline-flex rounded-[9px] border border-line bg-surface p-1 shadow-stone">
                <NavLink to={`/tickets${qs}`} end className={tab}>
                  <List className="h-3.5 w-3.5" /> List
                </NavLink>
                <NavLink to={`/board${boardQs}`} className={tab}>
                  <KanbanSquare className="h-3.5 w-3.5" /> Board
                </NavLink>
              </div>
            </div>
          </div>
          <div className="py-3 sm:py-4">
            <Toolbar showStatus={showStatus} showAssignee={showAssignee} />
          </div>
        </div>
        <div className="min-h-0 flex-1 scroll-pt-10 overflow-auto px-4 pb-8 md:px-8">{children}</div>
      </div>

      {isCreating && (
        <NewTicketDialog
          systems={activeSystems}
          defaultSystemCode={system?.active === 1 ? system.code : activeSystems[0].code}
          onCreated={(code) => {
            setIsCreating(false);
            f.set({ selected: code });
          }}
          onClose={() => setIsCreating(false)}
        />
      )}

      {/* No backdrop: the list or board stays clickable, so the next ticket opens in the same panel.
          From lg up the panel docks beside it; below lg it slides over the right side. */}
      {shownCode && (
        <aside
          ref={drawerRef}
          tabIndex={-1}
          aria-hidden={isClosing}
          aria-label="Ticket details"
          className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-overlay outline-none sm:max-w-xl ${
            // While it slides away it floats over the board, so the board takes its space back at once.
            isClosing
              ? "pointer-events-none animate-[drawer-out_180ms_ease-in_forwards] lg:w-[min(560px,45%)]"
              : "animate-[drawer-in_220ms_ease-out] motion-reduce:animate-none lg:static lg:z-auto lg:w-[min(560px,45%)] lg:shrink-0"
          }`}
        >
          <IssueView key={shownCode} code={shownCode} variant="panel" onClose={closePanel} />
        </aside>
      )}
    </div>
  );
}
