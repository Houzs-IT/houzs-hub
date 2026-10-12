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
    `flex items-center gap-1.5 whitespace-nowrap rounded px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-all duration-150 ${
      isActive ? "bg-primary text-primary-on shadow-sm" : "text-ink-subtle hover:bg-primary-soft hover:text-primary"
    }`;

  return (
    <div className="relative flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="px-8 pt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="eyebrow">IT Hub · Tickets</div>
              <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">{title}</h1>
            </div>
            <div className="inline-flex rounded-md border border-line bg-surface p-1 shadow-stone">
              <NavLink to={`/tickets${qs}`} end className={tab}>
                <List className="h-3.5 w-3.5" /> List
              </NavLink>
              <NavLink to={`/board${qs}`} className={tab}>
                <KanbanSquare className="h-3.5 w-3.5" /> Board
              </NavLink>
            </div>
          </div>
          <div className="py-4">
            <Toolbar showStatus={showStatus} showAssignee={showAssignee} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-8 pb-8">{children}</div>
      </div>

      {selected && (
        <aside className="w-[min(640px,50%)] shrink-0 border-l border-line bg-surface shadow-overlay">
          <IssueView key={selected} code={selected} variant="panel" onClose={() => f.set({ selected: null })} />
        </aside>
      )}
    </div>
  );
}
