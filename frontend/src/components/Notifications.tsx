import { Bell, CheckCircle2, Inbox, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Notification, type NotificationsResponse, type Status } from "../api/client";
import { fmtAgo } from "../lib/format";
import { STATUS_LABEL } from "../lib/labels";
import { useOutside } from "./FilterButton";
import { useHub } from "./Layout";

const KIND_STYLE = {
  created: { Icon: Inbox, label: "New ticket", color: "bg-loz-blue text-loz-blue-ink" },
  comment: { Icon: MessageSquare, label: "Comment", color: "bg-loz-orange text-loz-orange-ink" },
  status: { Icon: CheckCircle2, label: "Closed", color: "bg-loz-green text-loz-green-ink" },
};

export const kindStyle = (notification: Notification) => KIND_STYLE[notification.kind];

export function describeNotification(notification: Notification) {
  if (notification.kind === "created") return `Submitted by ${notification.author_name}`;
  if (notification.kind === "status") {
    return `${notification.author_name} marked it ${STATUS_LABEL[notification.to_value as Status] ?? notification.to_value}`;
  }
  const note = notification.visibility === "internal" ? " (internal note)" : "";
  return `${notification.author_name}${note}: ${notification.body ?? ""}`;
}

export function NotificationIcon({ notification }: { notification: Notification }) {
  const { Icon, color } = kindStyle(notification);
  return (
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${color}`}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function NotificationBell() {
  const { stats, version } = useHub();
  const [isOpen, setIsOpen] = useState(false);
  const [latest, setLatest] = useState<NotificationsResponse | null>(null);
  const close = useCallback(() => setIsOpen(false), []);
  const ref = useOutside<HTMLDivElement>(isOpen, close);
  const unread = stats.unread_notifications;

  useEffect(() => {
    if (isOpen) api<NotificationsResponse>("/notifications?page_size=5").then(setLatest).catch(() => {});
  }, [isOpen, version]);

  return (
    <div ref={ref}>
      <button
        onClick={() => setIsOpen((open) => !open)}
        className="relative grid h-10 w-10 place-items-center rounded-md text-sidebar-ink-muted transition-colors hover:bg-[var(--sidebar-hover)] hover:text-accent-bright"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={isOpen}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-loz-red-ink px-1 text-[10px] font-bold leading-none text-surface">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute left-3 top-full z-50 mt-1 w-[min(340px,calc(100vw-32px))] rounded-[10px] border border-transparent bg-overlay text-ink shadow-overlay">
          <div className="border-b border-line px-4 py-2.5 text-[13px] font-bold">Notifications</div>
          <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
            {latest?.notifications.map((notification) => (
              <Link
                key={notification.id}
                to={`/tickets/${notification.ticket_code}`}
                onClick={close}
                className="flex gap-3 px-4 py-2.5 hover:bg-hover"
              >
                <NotificationIcon notification={notification} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-docno font-semibold text-accent">{notification.ticket_code}</span>
                    <span className="text-ink-subtlest">{fmtAgo(notification.created_at)}</span>
                    {notification.id > latest.seen_id && <span className="ml-auto h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}
                  </div>
                  <div className="truncate text-[13px] text-ink">{notification.ticket_title}</div>
                  <div className="truncate text-xs text-ink-subtle">{describeNotification(notification)}</div>
                </div>
              </Link>
            ))}
            {latest && latest.notifications.length === 0 && <div className="px-4 py-8 text-center text-sm text-ink-subtlest">Nothing yet</div>}
            {!latest && <div className="px-4 py-8 text-center text-sm text-ink-subtlest">Loading...</div>}
          </div>
          <Link to="/notifications" onClick={close} className="block border-t border-line px-4 py-2.5 text-center text-[13px] font-semibold text-primary hover:bg-hover">
            View all activity history
          </Link>
        </div>
      )}
    </div>
  );
}
