import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type TicketRow } from "../api/client";
import { Avatar, Lozenge, PriorityIcon, TypeIcon } from "../components/Bits";
import { useHub } from "../components/Layout";
import ProjectShell from "../components/ProjectShell";
import { fmtAgo, fmtDate, fmtDateTime, sla } from "../lib/format";
import { ACTIVE, isReporterWaiting } from "../lib/labels";
import { useFilters } from "../lib/useFilters";
import { usePoll } from "../lib/usePoll";

type ListResp = { tickets: TicketRow[]; total: number; page: number; page_size: number };

// Reporter only shows from 1440px, so the table fits a 1280-1366px laptop without sideways scroll.
const WIDE_ONLY = "hidden min-[1440px]:table-cell";

type Col = { key: string; label: string; sort?: string; className?: string };
const COLS: Col[] = [
  { key: "type", label: "Type", className: "w-16" },
  { key: "key", label: "Key", sort: "key", className: "w-32" },
  { key: "summary", label: "Summary" },
  { key: "status", label: "Status", sort: "status", className: "w-40" },
  { key: "priority", label: "Priority", sort: "priority", className: "w-24" },
  { key: "assignee", label: "Assignee", sort: "assignee", className: "w-36" },
  { key: "reporter", label: "Reporter", className: `w-36 ${WIDE_ONLY}` },
  { key: "created", label: "Created", sort: "created", className: "w-28" },
  { key: "updated", label: "Updated", sort: "updated", className: "w-24" },
];

export default function ListPage({ queue = false }: { queue?: boolean }) {
  const { version, refresh } = useHub();
  const f = useFilters();
  const navigate = useNavigate();
  const [data, setData] = useState<ListResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = f.apiQuery({ page_size: "15", ...(queue ? { assignee: "me" } : {}) });
  if (!query.get("status")) query.set("status", "active");
  const qs = query.toString();

  const load = useCallback(() => {
    api<ListResp>(`/tickets?${qs}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [qs]);
  useEffect(load, [load, version]);
  usePoll(load, 60_000);

  const sort = f.get("sort") ?? "updated";
  const dir = f.get("dir") ?? "desc";
  const selected = f.get("selected");
  const page = Number(f.get("page") ?? 1);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  function sortBy(key: string) {
    if (sort === key) f.set({ sort: key, dir: dir === "desc" ? "asc" : "desc" });
    else f.set({ sort: key, dir: "desc" });
  }

  async function pickup(code: string) {
    try {
      await api(`/tickets/${code}/pickup`, { method: "POST" });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const canClearFilters = f.hasFilters || !!f.get("status");
  const emptyState = (
    <div className="py-16 text-center text-sm text-ink-subtle">
      {queue && !canClearFilters ? "Nothing is assigned to you right now." : "No tickets match these filters."}
      {canClearFilters && (
        <button className="btn-subtle ml-2" onClick={f.clear}>
          Clear filters
        </button>
      )}
    </div>
  );

  return (
    <ProjectShell view={queue ? "My queue" : "List"} showAssignee={!queue}>
      {error && (
        <div role="alert" className="mb-3 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
          {error}
        </div>
      )}
      {/* With a ticket open beside it, the table would be a sideways-scrolling strip, so the cards show instead. */}
      <div className={`space-y-2 ${selected ? "" : "lg:hidden"}`}>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-ink-subtle">
            Sort by
            <select className="input" value={sort} onChange={(e) => f.set({ sort: e.target.value, dir: "desc" })}>
              {COLS.filter((column) => column.sort).map((column) => (
                <option key={column.key} value={column.sort}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-default px-2.5"
            onClick={() => sortBy(sort)}
            aria-label={dir === "desc" ? "Sorted descending, switch to ascending" : "Sorted ascending, switch to descending"}
          >
            {dir === "desc" ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
        {data?.tickets.map((ticket) => {
          const ticketSla = sla(ticket.created_at, ticket.priority, ticket.status, ticket.legacy_code);
          return (
            <button
              key={ticket.code}
              onClick={() => f.set({ selected: ticket.code })}
              className={`card block w-full p-3 text-left ${selected === ticket.code ? "border-primary ring-2 ring-primary/25" : ""}`}
            >
              <div className="flex items-center gap-2">
                <TypeIcon type={ticket.type} />
                <span className="font-docno text-[12.5px] font-semibold text-accent">{ticket.code}</span>
                <span className="ml-auto">
                  <Lozenge status={ticket.status} />
                </span>
              </div>
              <div className="mt-1.5 line-clamp-2 text-sm font-medium text-ink">{ticket.title}</div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
                <span className="flex items-center gap-1 capitalize">
                  <PriorityIcon priority={ticket.priority} /> {ticket.priority}
                </span>
                <span className="flex min-w-0 items-center gap-1">
                  <Avatar name={ticket.assignee_name} size={18} />
                  <span className="truncate">{ticket.assignee_name ?? "Unassigned"}</span>
                </span>
                <span>{fmtAgo(ticket.updated_at)}</span>
                {ticketSla?.overdue && <span className="pill bg-loz-red text-loz-red-ink">{ticketSla.label}</span>}
                {isReporterWaiting(ticket) && (
                  <span className="inline-flex items-center gap-1 font-medium text-primary">
                    <MessageSquare className="h-3.5 w-3.5" /> Replied
                  </span>
                )}
              </div>
            </button>
          );
        })}
        {data && data.tickets.length === 0 && emptyState}
        {!data && !error && <div className="py-16 text-center text-sm text-ink-subtle">Loading...</div>}
      </div>

      <div className={`card min-w-[970px] min-[1440px]:min-w-[1130px] ${selected ? "hidden" : "hidden lg:block"}`}>
      <table className="w-full table-fixed border-collapse text-[13px]">
        <thead className="sticky top-0 z-10">
          <tr>
            {COLS.map((c) => (
              <th
                key={c.key}
                aria-sort={c.sort && sort === c.sort ? (dir === "desc" ? "descending" : "ascending") : undefined}
                className={`border-b-2 border-line bg-surface-dim px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-brand text-ink-subtle first:rounded-tl-[10px] first:pl-4 last:rounded-tr-[10px] ${c.className ?? ""}`}
              >
                {c.sort ? (
                  <button className="-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase hover:text-primary" onClick={() => sortBy(c.sort!)}>
                    {c.label}
                    {sort === c.sort && (dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data?.tickets.map((t) => {
            const s = sla(t.created_at, t.priority, t.status, t.legacy_code);
            const reporterReplied = isReporterWaiting(t);
            return (
              <tr
                key={t.code}
                onClick={() => f.set({ selected: t.code })}
                onDoubleClick={() => navigate(`/tickets/${t.code}`)}
                tabIndex={0}
                aria-label={`${t.code} ${t.title}`}
                onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && f.set({ selected: t.code })}
                className={`group h-11 cursor-pointer border-b border-line-subtle outline-none last:border-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${selected === t.code ? "bg-primary-soft" : "hover:bg-surface-2"}`}
              >
                <td className="pl-4 pr-3">
                  <TypeIcon type={t.type} />
                </td>
                <td className="truncate px-3 font-docno text-[12.5px] font-semibold text-accent">{t.code}</td>
                <td className="px-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-ink">{t.title}</span>
                    {s?.overdue && (
                      <span className="pill bg-loz-red text-loz-red-ink">
                        {s.label}
                      </span>
                    )}
                    {reporterReplied && (
                      <span title="Reporter replied" className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-primary">
                        <MessageSquare className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3">
                  <Lozenge status={t.status} />
                </td>
                <td className="px-3">
                  <div className="flex items-center gap-1.5 capitalize text-ink-subtle">
                    <PriorityIcon priority={t.priority} /> {t.priority}
                  </div>
                </td>
                <td className="px-3" onClick={(e) => !t.assignee_id && ACTIVE.includes(t.status) && e.stopPropagation()}>
                  {t.assignee_name ? (
                    <div className="flex items-center gap-2">
                      <Avatar name={t.assignee_name} size={24} />
                      <span className="truncate">{t.assignee_name}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Avatar name={null} size={24} />
                      {/* Touch screens cannot hover, so Pick up is always shown there. */}
                      <span className={`text-ink-subtlest ${ACTIVE.includes(t.status) ? "group-hover:hidden group-focus-within:hidden [@media(hover:none)]:hidden" : ""}`}>
                        Unassigned
                      </span>
                      {ACTIVE.includes(t.status) && (
                        <button className="tap hidden h-6 rounded px-1.5 text-xs font-medium text-primary hover:bg-primary-soft group-hover:inline group-focus-within:inline [@media(hover:none)]:inline-block" onClick={() => pickup(t.code)}>
                          Pick up
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td className={`px-3 ${WIDE_ONLY}`}>
                  <div className="flex items-center gap-2">
                    <Avatar name={t.reporter_name} size={24} />
                    <span className="truncate">{t.reporter_name}</span>
                  </div>
                </td>
                <td className="truncate px-3 text-ink-subtle" title={fmtDateTime(t.created_at)}>
                  {fmtDate(t.created_at)}
                </td>
                <td className="truncate px-3 text-ink-subtle">{fmtAgo(t.updated_at)}</td>
              </tr>
            );
          })}
          {data && data.tickets.length === 0 && (
            <tr>
              <td colSpan={COLS.length}>{emptyState}</td>
            </tr>
          )}
          {!data && !error && (
            <tr>
              <td colSpan={COLS.length} className="py-16 text-center text-ink-subtle">
                Loading...
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {data && (
        <div className="flex items-center justify-between py-3 text-sm text-ink-subtle">
          <span>
            {data.total} {data.total === 1 ? "ticket" : "tickets"}
          </span>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <button className="btn-subtle px-2" aria-label="Previous page" disabled={page <= 1} onClick={() => f.set({ page: String(page - 1) })}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2">
                {page} / {pages}
              </span>
              <button className="btn-subtle px-2" aria-label="Next page" disabled={page >= pages} onClick={() => f.set({ page: String(page + 1) })}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </ProjectShell>
  );
}
