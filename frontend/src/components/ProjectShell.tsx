import { KanbanSquare, List } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useFilters } from "../lib/useFilters";
import IssueView from "./IssueView";
import Toolbar from "./Toolbar";

// Header + view tabs + filters + optional issue side panel, shared by List / Board / My queue.
export default function ProjectShell({
  title,
  children,
  showStatus = true,
  showAssignee = true,
}: {
  title: string;
  children: ReactNode;
  showStatus?: boolean;
  showAssignee?: boolean;
}) {
  const f = useFilters();
  const { search } = useLocation();
  const selected = f.get("selected");
  const keep = new URLSearchParams(search);
  keep.delete("selected");
  keep.delete("page");
  const qs = keep.toString() ? `?${keep}` : "";

  // Century FilterPills segmented control: petrol fill on the active segment.
  const tab = ({ isActive }: { isActive: boolean }) =>
    `tap flex items-center gap-1.5 whitespace-nowrap rounded px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all duration-150 ${
      isActive ? "bg-primary text-primary-on shadow-sm" : "text-ink-subtle hover:bg-primary-soft hover:text-primary"
    }`;

  return (
    <div className="relative flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phones drop the eyebrow and shrink the title so the List/Board switch shares its row. */}
        <div className="px-4 pt-4 sm:pt-6 md:px-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="eyebrow max-sm:hidden">IT Hub · Tickets</div>
              <h1 className="text-[20px] font-extrabold tracking-tight text-ink sm:mt-1 sm:text-[24px]">{title}</h1>
            </div>
            <div className="inline-flex rounded-[9px] border border-line bg-surface p-1 shadow-stone">
              <NavLink to={`/tickets${qs}`} end className={tab}>
                <List className="h-3.5 w-3.5" /> List
              </NavLink>
              <NavLink to={`/board${qs}`} className={tab}>
                <KanbanSquare className="h-3.5 w-3.5" /> Board
              </NavLink>
            </div>
          </div>
          <div className="py-3 sm:py-4">
            <Toolbar showStatus={showStatus} showAssignee={showAssignee} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 pb-8 md:px-8">{children}</div>
      </div>

      {selected && (
        <aside className="absolute inset-0 z-20 shrink-0 border-l border-line bg-surface shadow-overlay md:static md:w-[min(640px,50%)]">
          <IssueView key={selected} code={selected} variant="panel" onClose={() => f.set({ selected: null })} />
        </aside>
      )}
    </div>
  );
}
