import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type TicketRow } from "../api/client";
import { Avatar, Lozenge, PriorityIcon, TypeIcon } from "../components/Bits";
import { useHub } from "../components/Layout";
import ProjectShell from "../components/ProjectShell";
import { fmtAgo, fmtDate, fmtDateTime, sla } from "../lib/format";
import { ACTIVE } from "../lib/labels";
import { useFilters } from "../lib/useFilters";
import { usePoll } from "../lib/usePoll";

type ListResp = { tickets: TicketRow[]; total: number; page: number; page_size: number };

type Col = { key: string; label: string; sort?: string; className?: string };
const COLS: Col[] = [
  { key: "type", label: "Type", className: "w-16" },
  { key: "key", label: "Key", sort: "key", className: "w-24" },
  { key: "summary", label: "Summary" },
  { key: "status", label: "Status", sort: "status", className: "w-44" },
  { key: "priority", label: "Priority", sort: "priority", className: "w-24" },
  { key: "assignee", label: "Assignee", sort: "assignee", className: "w-36" },
  { key: "reporter", label: "Reporter", className: "w-36" },
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
  usePoll(load, 30_000);

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

  return (
    <ProjectShell title={queue ? "My queue" : "IT Tickets"} showAssignee={!queue}>
      {error && <div className="mb-3 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">{error}</div>}
      <div className="card min-w-[1100px]">
      <table className="w-full table-fixed border-collapse text-[13px]">
        <thead className="sticky top-0 z-10">
          <tr>
            {COLS.map((c) => (
              <th
                key={c.key}
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
            const reporterReplied = t.last_public_actor === "reporter" && t.status !== "open" && ACTIVE.includes(t.status);
            return (
              <tr
                key={t.code}
                onClick={() => f.set({ selected: t.code })}
                onDoubleClick={() => navigate(`/tickets/${t.code}`)}
                className={`group h-11 cursor-pointer border-b border-line-subtle last:border-0 ${selected === t.code ? "bg-primary-soft" : "hover:bg-surface-2"}`}
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
                      <span className="text-ink-subtlest group-hover:hidden">Unassigned</span>
                      {ACTIVE.includes(t.status) && (
                        <button className="hidden h-6 rounded px-1.5 text-xs font-medium text-primary hover:bg-primary-soft group-hover:inline" onClick={() => pickup(t.code)}>
                          Pick up
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3">
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
              <td colSpan={COLS.length} className="py-16 text-center text-ink-subtlest">
                No tickets match these filters
              </td>
            </tr>
          )}
          {!data && !error && (
            <tr>
              <td colSpan={COLS.length} className="py-16 text-center text-ink-subtlest">
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
              <button className="btn-subtle px-2" disabled={page <= 1} onClick={() => f.set({ page: String(page - 1) })}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2">
                {page} / {pages}
              </span>
              <button className="btn-subtle px-2" disabled={page >= pages} onClick={() => f.set({ page: String(page + 1) })}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </ProjectShell>
  );
}
