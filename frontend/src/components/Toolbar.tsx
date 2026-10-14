import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import type { Status } from "../api/client";
import { ACTIVE, PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, TYPES, TYPE_LABEL } from "../lib/labels";
import { useFilters } from "../lib/useFilters";
import { Avatar, PriorityIcon, TypeIcon } from "./Bits";
import FilterButton from "./FilterButton";
import { useHub } from "./Layout";

export function statusSelection(raw: string | null): Status[] {
  if (raw === "all") return [];
  if (!raw || raw === "active") return ACTIVE;
  return raw.split(",") as Status[];
}

export default function Toolbar({ showStatus = true, showAssignee = true }: { showStatus?: boolean; showAssignee?: boolean }) {
  const { me, users, systems } = useHub();
  const f = useFilters();
  const [q, setQ] = useState(f.get("q") ?? "");

  useEffect(() => {
    const id = setTimeout(() => {
      if ((f.get("q") ?? "") !== q) f.set({ q: q || null });
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => setQ(f.get("q") ?? ""), [f.get("q")]);

  const statusSel = statusSelection(f.get("status"));
  const statusDefault = !f.get("status");
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const activeFilterCount =
    ["system", "type", "priority", "assignee"].filter((key) => f.list(key).length).length + (showStatus && !statusDefault ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <input className="input block w-full pl-8 sm:w-56" aria-label="Search tickets" placeholder="Search tickets" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <button className="btn-default sm:hidden" onClick={() => setIsFiltersOpen((open) => !open)} aria-expanded={isFiltersOpen}>
        <SlidersHorizontal className="h-4 w-4" /> Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
      </button>
      {/* On phones the filters fold behind the Filters button; from sm up the wrapper disappears. */}
      <div className={`${isFiltersOpen ? "flex" : "hidden"} w-full flex-wrap items-center gap-2 sm:contents`}>
        <FilterButton
          label="System"
          options={systems.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))}
          selected={f.list("system")}
          onChange={(v) => f.set({ system: v })}
        />
        <FilterButton
          label="Type"
          options={TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t], icon: <TypeIcon type={t} /> }))}
          selected={f.list("type")}
          onChange={(v) => f.set({ type: v })}
        />
        {showStatus && (
          <FilterButton
            label={statusDefault ? "Status: Active" : "Status"}
            isDefault={statusDefault}
            options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            selected={statusSel}
            onChange={(v) => {
              const isDefault = v.length === ACTIVE.length && ACTIVE.every((s) => v.includes(s));
              f.set({ status: isDefault ? null : v.length ? v : "all" });
            }}
          />
        )}
        <FilterButton
          label="Priority"
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} /> }))}
          selected={f.list("priority")}
          onChange={(v) => f.set({ priority: v })}
        />
        {showAssignee && (
          <FilterButton
            label="Assignee"
            options={[
              { value: "none", label: "Unassigned", icon: <Avatar name={null} size={20} /> },
              { value: "me", label: "Me", icon: <Avatar name={me.name} size={20} /> },
              ...users
                .filter((d) => d.id !== me.id)
                .map((d) => ({ value: String(d.id), label: d.name, icon: <Avatar name={d.name} size={20} /> })),
            ]}
            selected={f.list("assignee")}
            onChange={(v) => f.set({ assignee: v })}
          />
        )}
        {(f.hasFilters || (showStatus && !statusDefault)) && (
          <button className="btn-subtle" onClick={f.clear}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
