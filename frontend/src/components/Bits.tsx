import { Bookmark, Bug, ChevronDown, ChevronUp, ChevronsUp, Equal } from "lucide-react";
import type { Priority, Status, TicketType } from "../api/client";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_STYLE, TYPE_LABEL } from "../lib/labels";

export function Lozenge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full px-2 py-[3px] text-[10px] font-bold uppercase leading-none tracking-wider ${STATUS_STYLE[status]}`}
    >
      <span className="truncate">{STATUS_LABEL[status]}</span>
    </span>
  );
}

export function TypeIcon({ type, size = 16 }: { type: TicketType; size?: number }) {
  const Icon = type === "bug" ? Bug : Bookmark;
  return (
    <span
      title={TYPE_LABEL[type]}
      style={{ width: size, height: size }}
      className={`inline-grid shrink-0 place-items-center rounded-[3px] ${type === "bug" ? "bg-[#b23a3a]" : "bg-[#16695f]"}`}
    >
      <Icon className="text-white" style={{ width: size - 5, height: size - 5 }} strokeWidth={2.5} />
    </span>
  );
}

const PRIORITY_ICON = {
  urgent: { Icon: ChevronsUp, cls: "text-[#b23a3a]" },
  high: { Icon: ChevronUp, cls: "text-[#d9822b]" },
  medium: { Icon: Equal, cls: "text-[#b76b00]" },
  low: { Icon: ChevronDown, cls: "text-[#1565c0]" },
};

export function PriorityIcon({ priority }: { priority: Priority }) {
  const { Icon, cls } = PRIORITY_ICON[priority];
  return (
    <span title={PRIORITY_LABEL[priority]}>
      <Icon className={`h-4 w-4 shrink-0 ${cls}`} strokeWidth={2.75} />
    </span>
  );
}

const AVATAR_COLORS = ["#16695f", "#a16a2e", "#2f5d4f", "#1f3a8a", "#6a1b9a", "#a6471e", "#0c3f39", "#5a3a14"];

export function Avatar({ name, size = 24 }: { name: string | null | undefined; size?: number }) {
  if (!name) {
    return (
      <span
        style={{ width: size, height: size }}
        className="inline-grid shrink-0 place-items-center rounded-full border border-dashed border-line-strong bg-sunken"
        title="Unassigned"
      />
    );
  }
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  const color = AVATAR_COLORS[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span
      title={name}
      style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.42) }}
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
    >
      {initials}
    </span>
  );
}

export function SystemTag({ code }: { code: string }) {
  return (
    <span className="inline-flex h-5 items-center rounded border border-line bg-surface-2 px-1.5 font-docno text-[10.5px] font-semibold text-ink-subtle">
      {code}
    </span>
  );
}
