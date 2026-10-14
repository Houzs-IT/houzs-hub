import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, json, type Notification, type NotificationsResponse } from "../api/client";
import { useHub } from "../components/Layout";
import { NotificationIcon, describeNotification, kindStyle } from "../components/Notifications";
import { fmtAgo, fmtDateTime } from "../lib/format";
import { useFilters } from "../lib/useFilters";

const TABS = [
  { key: "all", label: "All" },
  { key: "tickets", label: "Tickets" },
  { key: "comments", label: "Comments" },
  { key: "closed", label: "Done / Closed" },
];

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

function dayLabel(iso: string) {
  const day = dayKey.format(new Date(iso));
  if (day === dayKey.format(new Date())) return "Today";
  if (day === dayKey.format(new Date(Date.now() - 86400_000))) return "Yesterday";
  return "Earlier";
}

export default function NotificationsPage() {
  const { version, refresh } = useHub();
  const filters = useFilters();
  const tab = filters.get("filter") ?? "all";
  const isUnreadOnly = filters.get("unread") === "1";
  const page = Number(filters.get("page") ?? 1);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The read mark when this page opened. Rows after it stay marked unread for this visit.
  const readMarkOnOpen = useRef<number | null>(null);

  const load = useCallback(() => {
    const query = new URLSearchParams({ page: String(page) });
    if (tab !== "all") query.set("filter", tab);
    if (isUnreadOnly) {
      query.set("unread", "1");
      if (readMarkOnOpen.current !== null) query.set("after", String(readMarkOnOpen.current));
    }
    api<NotificationsResponse>(`/notifications?${query}`)
      .then((response) => {
        readMarkOnOpen.current ??= response.seen_id;
        setData(response);
        setError(null);
        // Only the All tab marks read on view: a filtered tab would also clear unseen items of other kinds.
        const newestId = response.notifications[0]?.id ?? 0;
        if (tab === "all" && newestId > response.seen_id) api("/notifications/read", json("POST", { up_to: newestId })).then(() => refresh()).catch(() => {});
      })
      .catch((e: Error) => setError(e.message));
  }, [page, tab, isUnreadOnly, refresh]);
  useEffect(load, [load, version]);

  async function markAllRead() {
    try {
      await api("/notifications/read", json("POST", {}));
      readMarkOnOpen.current = Number.MAX_SAFE_INTEGER;
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const readMark = readMarkOnOpen.current ?? data?.seen_id ?? 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const groups: { label: string; items: Notification[] }[] = [];
  for (const notification of data?.notifications ?? []) {
    const label = dayLabel(notification.created_at);
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1)!.items.push(notification);
  }

  return (
    <div className="h-full overflow-auto px-4 py-6 md:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="eyebrow">Houzs Hub · Activity</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-[24px] font-extrabold tracking-tight text-ink">
            Notifications {data && <span className="text-[15px] font-semibold text-ink-subtle">({data.total_capped ? "1000+" : data.total})</span>}
          </h1>
          <button className="btn-default" onClick={markAllRead}>
            Mark all as read
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {TABS.map((item) => (
            <button
              key={item.key}
              onClick={() => filters.set({ filter: item.key === "all" ? null : item.key })}
              aria-pressed={tab === item.key}
              className={`tap h-9 rounded-md px-3 text-[13px] font-semibold ${tab === item.key ? "bg-primary text-primary-on" : "text-ink-subtle hover:bg-hover"}`}
            >
              {item.label}
            </button>
          ))}
          <button
            onClick={() => filters.set({ unread: isUnreadOnly ? null : "1" })}
            aria-pressed={isUnreadOnly}
            className={`tap ml-auto h-9 rounded-full border px-3 text-[13px] font-semibold ${
              isUnreadOnly ? "border-primary bg-primary-soft text-primary" : "border-line text-ink-subtle hover:bg-hover"
            }`}
          >
            Unread only
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
            {error}
          </div>
        )}

        {groups.map((group) => (
          <section key={group.label} className="mt-6">
            <div className="section-title mb-2">{group.label}</div>
            <div className="card divide-y divide-line-subtle">
              {group.items.map((notification) => {
                const isUnread = notification.id > readMark;
                const { label, color } = kindStyle(notification);
                return (
                  <Link
                    key={notification.id}
                    to={`/tickets/${notification.ticket_code}`}
                    className={`flex gap-3 border-l-4 p-4 hover:bg-surface-2 ${isUnread ? "border-l-primary" : "border-l-transparent"}`}
                  >
                    {isUnread && <span className="sr-only">Unread:</span>}
                    <NotificationIcon notification={notification} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase ${color}`}>{label}</span>
                        <span className="font-docno font-semibold text-accent">{notification.ticket_code}</span>
                        <span className="text-ink-subtle" title={fmtDateTime(notification.created_at)}>
                          {fmtAgo(notification.created_at)}
                        </span>
                      </div>
                      <div className={`mt-1 truncate text-sm text-ink ${isUnread ? "font-bold" : "font-medium"}`}>{notification.ticket_title}</div>
                      <div className="mt-0.5 line-clamp-2 text-[13px] text-ink-subtle">{describeNotification(notification)}</div>
                    </div>
                    <ExternalLink className="h-4 w-4 shrink-0 self-center text-ink-subtle" aria-hidden />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}

        {data && data.notifications.length === 0 && (
          <div className="py-16 text-center text-sm text-ink-subtle">{isUnreadOnly ? "No unread notifications" : "No notifications yet"}</div>
        )}
        {!data && !error && <div className="py-16 text-center text-sm text-ink-subtle">Loading...</div>}

        {pages > 1 && (
          <div className="flex items-center justify-end gap-1 py-4 text-sm text-ink-subtle">
            <button className="btn-subtle px-2" disabled={page <= 1} onClick={() => filters.set({ page: String(page - 1) })} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2">
              {page} / {pages}
            </span>
            <button className="btn-subtle px-2" disabled={page >= pages} onClick={() => filters.set({ page: String(page + 1) })} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
